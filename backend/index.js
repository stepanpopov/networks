const path = require('path')
const { v4: uuidv4 } = require('uuid');
const express = require("express");
var message_store = require("./message_store")

const app = express();
app.use(express.json());

const port = 8888;

const SEND_MESSAGE_INTERVAL = 4000;
const CHECK_MESSAGE_INTERVAL = 2000;
const SEND_AGAIN_MESSAGE_TIMEOUT = 3000;
const BUFFER_SIZE = 100; // len of not accepted symbols
const FAIL_TIMES_TO_RESET_CONNECTION = 20; // соединение прерывается после SEND_AGAIN_MESSAGE_TIMEOUT * FAIL_TIMES_TO_RESET_CONNECTION раз
const messagesToSent = ['я люблю рип', 'я не люблю рип', 'люблю сети']

const STATE = {
    SYN_RECEIVED: 0,
    ESTABILISHED: 1,
    CLOSED: 2, 
}

const getRandom = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const getRandomSeq = () => {
    return getRandom(0, 1000)
}

const randomChoice = (array) => {
    return array[getRandom(0, array.length - 1)]
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
})

const sockets = {};

const messageStore = new message_store.MessageStore();

app.post("/handshake", (req, res) => {
    try {
        if (req.body.hasOwnProperty('socketID')) {
            const { ACK, socketID } = req.body;

            if (sockets[socketID].seq + 1 === ACK) {
                sockets[socketID] = { seq: ACK, state: STATE.ESTABILISHED, fails: 0, ack: ACK }

                res.sendStatus(200);
                return;
            }

            res.status(400).json({ error: "проверка на ACK провалилась" })
            return;
        } 

        const socketID = uuidv4();
    
        const { SEQ } = req.body;

        const MY_SEQ = getRandomSeq();
        sockets[socketID] = { seq: MY_SEQ, state: STATE.SYN_RECEIVED }

        res.json({ ACK: SEQ + 1, SEQ: MY_SEQ, socketID })

    } catch (e) {
        res.status(400).json({ error: e.message })
    }
});

app.post("/finish", (req, res) => {
    try {
        const { socketID } = req.body;
        sockets[socketID] = undefined
        res.sendStatus(200);
    } catch (e) {
        res.status(400).json({ error: e.message })
    }
})

app.post("/subscribe", async (req, res) => {
    try {
        const { socketID } = req.body;
        if (sockets[socketID] === void 0 || sockets[socketID].state !== STATE.ESTABILISHED) {
            res.status(400).json({ error: "Соединение не установлено" })
            return
        }

        if (sockets[socketID].fails === FAIL_TIMES_TO_RESET_CONNECTION) {
            sockets[socketID] = undefined;
            res.status(400).json({ error: "Таймаут, установите соединение заново" })
            return
        }

        const [message, seq] = await messageStore
            .getMessage(socketID, CHECK_MESSAGE_INTERVAL);

        if (sockets[socketID].ack >= seq + message.length) {
            return
        }

        console.log("sent msg seq: %d, ack: %d", seq, sockets[socketID].ack)
        res.json({ message, SEQ: seq })

        setTimeout(async (socketID, message, seq) => {
            if (sockets[socketID] === void 0) {
                return
            }
            
            if (sockets[socketID].ack >= seq + message.length) {
                sockets[socketID].fails = 0;
                return
            }

            sockets[socketID].fails += 1;

            await messageStore.addMessage(socketID, message, seq)
            
            console.log("saved msg for retry send msg, seq: %d", seq)
        }, SEND_AGAIN_MESSAGE_TIMEOUT, socketID, message, seq)
    } catch (e) {
        res.status(400).json({ error: e.message })
    }

});


app.post("/ack", (req, res) => {
    const { ACK, socketID } = req.body;
    console.log('GOT ACK: %d', ACK)
    const cur_ack = sockets[socketID].ack;
    sockets[socketID].ack = (cur_ack < ACK ? ACK : cur_ack);
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Functions that sends messages to the clients
setInterval(() => {
    for (const socketID in sockets) {
        if (sockets[socketID] === void 0 || sockets[socketID].state !== STATE.ESTABILISHED) {
            return
        }

        const cur_seq = sockets[socketID].seq;
        const cur_ack = sockets[socketID].ack;

        if (cur_seq - cur_ack > BUFFER_SIZE) {
            return;
        }
        
        const message = randomChoice(messagesToSent);
        messageStore.addMessage(socketID, message, cur_seq)
        sockets[socketID].seq = cur_seq + message.length
    }
}, SEND_MESSAGE_INTERVAL);
