const path = require('path')
const { v4: uuidv4 } = require('uuid');
const express = require("express");

const EventEmitter = require('events');

class BufferedEventEmitter extends EventEmitter {
    constructor() {
        super();
        this.buffer = new Map();
    }

    once(eventName, callback) {
        let events = this.buffer.get(eventName)
        console.log("EVENTS: ", events)

        if (events === void 0 || events.length === 0) {
            return super.once(eventName, callback)
        }
        console.log("EVENTS: not empty")

        const lastEventArgs = events[0]
        this.buffer.set(eventName, events.slice(1))

        return super.prependOnceListener(eventName, callback)._emit(eventName, ...lastEventArgs)
    }

    once_block(interval, eventName, callback) {
        let block = true;
        let args = [];
        this.once(eventName, (...callback_args) => {
            args = callback_args
            console.log("before callback")
            callback(...callback_args)
            console.log("after callback")
            block = false
        })

        console.log("before wait")
        return new Promise((resolve) => {
            const intervalId = setInterval(() => {
                if (block === false) {
                  clearInterval(intervalId);
                  resolve(args);
                }
              }, interval);
        })
    }

    emit(eventName, ...args) {
        console.log("in emit")
        if (this.listenerCount(eventName).length === 0) {
            console.log("long emit")
            let events = this.buffer.get(eventName)
            console.log(events)
            if (events === void 0) {
                events = []
            } 
            this.buffer.set(eventName, [...events, args])
            return false
        } else {
            console.log("fast emit")
            return super.emit(eventName, ...args);
        }
    }

    _emit(eventName, ...args) {
        console.log("_emit called")
        this.emit(eventName, ...args)
        return this
    }
}

const app = express();
app.use(express.json());

const port = 8888;

const SEND_MESSAGE_INTERVAL = 1000;
const CHECK_MESSAGE_INTERVAL = 100;
const SEND_AGAIN_MESSAGE_TIMEOUT = 20000;
const BUFFER_SIZE = 100; // len of not accepted symbols
const FAIL_TIMES_TO_RESET_CONNECTION = 5; // соединение прерывается после SEND_AGAIN_MESSAGE_TIMEOUT * FAIL_TIMES_TO_RESET_CONNECTION раз

const STATE = {
    SYN_RECEIVED: 0,
    ESTABILISHED: 1,
    CLOSED: 2, 
}

const getRandomSeq = () => {
    min = 0;
    max = 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
})

const sockets = {};

const messageEmitter = new BufferedEventEmitter();

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

app.post("/subscribe", (req, res) => {
    const { socketID } = req.body;
    if (sockets[socketID] === void 0) {
        res.status(400).json({ error: "Не существует такого соединения" })
        return
    }
    if (sockets[socketID].state !== STATE.ESTABILISHED) {
        res.status(400).json({ error: "Соединение не установлено" })
        return
    }

    if (sockets[socketID].fails === FAIL_TIMES_TO_RESET_CONNECTION) {
        sockets[socketID] = undefined;
        res.status(400).json({ error: "Таймаут, установите соединение заново" })
        return
    }

    messageEmitter.once_block(CHECK_MESSAGE_INTERVAL, socketID, (message, seq) => {
        // TODO: забыть отправить
        res.json({ message, SEQ: seq })
    })
    .then((args) => {
        const message = args[0]
        const seq = args[1]
        console.log("THEN")
        console.log(message, seq)
        setTimeout(() => {
            if (sockets[socketID] === void 0) {
                return
            }
            
            console.log("SEQ ACK %d %d", seq, sockets[socketID].ack)
            if (sockets[socketID].ack >= seq + message.length) {
                sockets[socketID].fails = 0;
                return
            }
    
            sockets[socketID].fails += 1;
    
            messageEmitter.emit(socketID, message, seq)
            console.log("call emit for retry send msg")
        }, SEND_AGAIN_MESSAGE_TIMEOUT);
    });
});


app.post("/ack", (req, res) => {
    const { ACK, socketID } = req.body;
    const cur_ack = sockets[socketID].ack;
    sockets[socketID].ack = (cur_ack < ACK ? ACK : cur_ack);
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Functions that sends messages to the clients
setInterval(() => {
    console.log("listeners: %d", messageEmitter.listenerCount())

    for (const socketID in sockets) {
        console.log("listeners for %s: %d", socketID, messageEmitter.listenerCount())
        if (sockets[socketID].state !== STATE.ESTABILISHED) {
            console.log("%d not estabilished", socketID)
            return
        }

        const cur_seq = sockets[socketID].seq;
        const cur_ack = sockets[socketID].ack;

        if (cur_seq - cur_ack > BUFFER_SIZE) {
            console.log("cur_seq - cur_ack > 100")
            continue
        }
        
        const message = 'Я ЛЮБЛЮ РИП';
        messageEmitter.emit(socketID, message, cur_seq)
        sockets[socketID].seq = cur_seq + message.length
    }
}, SEND_MESSAGE_INTERVAL);
