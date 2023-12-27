const list = document.getElementById('list');
const startButton = document.getElementById('start');
const finishButton = document.getElementById('finish');

let streamIntervalId = 0;


const handshake = async () => {
    const MY_SEQ = Math.floor(Math.random() * 1000);
    const response = await fetch('/handshake', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ SEQ: MY_SEQ }),
    });

    if (response.status !== 200) {
        console.error('Ошибка при выполнении запроса, статус', response.status);
        throw new Error('Не получилось подключиться к серверу');
    }

    const { ACK, SEQ, socketID } = await response.json();
    if (ACK != MY_SEQ + 1) {
        console.error('Ошибка: Полученный SYN+1 не совпадает с ожидаемым значением.');
        throw new Error('Полученный SYN+1 не совпадает с ожидаемым значением.');
    }

    const response2 = await fetch('/handshake', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ACK: SEQ + 1, socketID }),
    });


    if (response2.status !== 200) {
        console.error('Ошибка при выполнении запроса, статус', response2.status);
        throw new Error('Не получилось подключиться к серверу');
    }

    return { socketID, ACK: SEQ + 1}
};

const subscribe = async (socketID) => {
    const response = await fetch('/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ socketID }),
    });

    if (response.status !== 200 ) {
        const { error } = await response.json();
        console.log(error)
        throw new Error(error)
    }

    return await response.json();
}

const sendACK = async (socketID, ACK) => {
    const resp = await fetch('/ack', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ socketID, ACK }),
    });

    if (resp.status != 200) {
        const { error } = await resp.json();
        throw new Error(error)
    }
}

const loosingtMessage = (probability) => (Math.random() <= probability)

const seq_windows = [];

const startStream = async (socketID, start_ack) => {
    let ack = start_ack;

    const intervalId = setInterval(async () => {
        try {
            const { message, SEQ } = await subscribe(socketID);
            console.log("CUR ACK:", ack)
            console.log("CUR SEQ:", SEQ)
            if (loosingtMessage(0.001)) {
                showMessage('потеряли сообщение')
                return
            }
            
            if (ack > SEQ) {
                showMessage('получили дубликат')
                sendACK(socketID, ack);
                return
            }

            // TODO: если получили seq с пропусками
            console.log(message);
            showMessage(message + ', SEQ: ' + SEQ);


            for (let i = 0; i < seq_windows.length; i++) {
                if (SEQ === seq_windows[i][0] && SEQ + message.length === seq_windows[i][1]) {
                    if (i === 0 && seq_windows.length === 1) ack = seq_windows[0][1]
                    if (i === 0 && seq_windows.length > 1) ack = seq_windows[1][0]
                    seq_windows.splice(i, 1)
                }

                // TODO: we can cover only a part of seq window
            }

            console.log("CURRENT CLIENT ACK FOR SERVER MESSAGES: ", ack)

            if (SEQ === ack) {
                ack = SEQ + message.length
                sendACK(socketID, ack);
            } else if (SEQ < ack) {
                sendACK(socketID, ack);
            } else {
                seq_windows.push([SEQ, SEQ + message.length])

                // TODO: we can get seq windows in a seq window
                seq_windows.sort((a, b) => (a[0] < b[0]))
            }
            
        } catch (e) {
            showMessage(e.message);
            clearInterval(intervalId)
            console.log(e);
        }
    }, 1000)
    return intervalId
}

const showMessage = (message) => {
    const node = document.createElement('li');
    node.innerText = message;
    list.appendChild(node);
};

const startConnectToServer = async () => {
    finishButton.disabled = false;
    startButton.disabled = true;
  
    try {
        const { socketID, ACK } = await handshake();
        console.log('aaa')
        streamIntervalId = await startStream(socketID, ACK);
    } catch (e) {
        console.log(e);
        showMessage(e.message)
    }
}

const finishConnectToServer = () => {
  startButton.disabled = false;
  finishButton.disabled = true;
  
  clearInterval(streamIntervalId)
}
