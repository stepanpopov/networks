const list = document.getElementById('list');
const startButton = document.getElementById('start');
const finishButton = document.getElementById('finish');

const SOCKET_ID_KEY = 'socketID';
const STREAM_ID_KEY = 'streamID';

const SUBSCRIBE_AGAIN_INTERVAL = 3000;
const SUBSCRIBE_ABORT_TIMEOUT = 1000;


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

const finish = async (socketID) => {
    const response = await fetch('/finish', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ socketID }),
    });

    if (response.status !== 200) {
        console.error('Ошибка при выполнении запроса, статус', response.status);
        throw new Error('Не получилось подключиться к серверу');
    }
}

const subscribe = async (socketID) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUBSCRIBE_ABORT_TIMEOUT);

    const response = await fetch('/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ socketID }),
    });
    clearTimeout(timeoutId)

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
    console.log('SENT ACK!')

    if (resp.status != 200) {
        const { error } = await resp.json();
        throw new Error(error)
    }
}

const loosingMessage = (probability) => (Math.random() <= probability)

const messagesStorage = new Set();

const startStream = async (socketID, start_ack) => {
    let ack = start_ack;

    const intervalId = setInterval(async () => {
        try {
            const { message, SEQ } = await subscribe(socketID);
            
            if (loosingMessage(0.1)) {
                showMessage('потеряли сообщение')
                return
            }
            
            if (ack > SEQ) {
                showMessage('получили дубликат')
                return
            }

            if (ack < SEQ) {
                showMessage('получили сообщение для будущего')
                messagesStorage.add([message, SEQ]);

                return
            }

            
            const last_ack = ack
            ack = SEQ + message.length

            if (last_ack === SEQ) {
                // preventing dublicates
                showMessage(message + ', SEQ: ' + SEQ);
            }
            
            await sendACK(socketID, ack);

            const messages = [...messagesStorage].sort((a, b) => (a[1] < b[1]))
            if (messages.length !== 0 && messages[0][1] <= ack) {
                const last_ack = ack
                ack = SEQ + message.length

                if (last_ack === SEQ) {
                    // preventing dublicates
                    showMessage(message + ', SEQ: ' + messages[0][1]);
                }
                
                messagesStorage.delete(messages[0]);
            }
            for (let i = 1; i < messages.length; i++) {
                if (messages[i - 1][1] === messages[i][1]) {
                    messagesStorage.delete(messages[i])
                    continue;
                }

                if (messages[i][1] <= ack) {
                    const last_ack = ack
                    ack = SEQ + message.length

                    if (last_ack === SEQ) {
                        // preventing dublicates
                        showMessage(message + ', SEQ: ' + messages[0][1]);
                    }
                    
                    messagesStorage.delete(messages[i]);    
                } else {
                    break;
                }
            }
        } catch (e) {
            showMessage(e.message);
            clearInterval(intervalId)
            console.log(e);
        }
    }, SUBSCRIBE_AGAIN_INTERVAL)
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
        sessionStorage.setItem(SOCKET_ID_KEY, socketID);

        const streamIntervalId = await startStream(socketID, ACK);
        sessionStorage.setItem(STREAM_ID_KEY, streamIntervalId);
    } catch (e) {
        console.log(e);
        showMessage(e.message)
    }
}

const finishConnectToServer = async () => {
  startButton.disabled = false;
  finishButton.disabled = true;
  
  const streamIntervalId = sessionStorage.getItem(STREAM_ID_KEY);
  if (streamIntervalId) {
    clearInterval(streamIntervalId)
  }

  const socketID = sessionStorage.getItem(SOCKET_ID_KEY);
  if (socketID) {
    await finish(socketID)
  }
}
