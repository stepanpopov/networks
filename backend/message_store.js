const Mutex = require('async-mutex').Mutex;

class MessageStore {
    constructor() {
        this.messages = new Map();
        this.mutex = new Mutex();
    }

    _addMessage(socketID, message, seq) {
        let mesForSocket = this.messages.get(socketID);
        if (mesForSocket === void 0) {
            mesForSocket = []
        }

        mesForSocket.push([message, seq])
        this.messages.set(socketID, mesForSocket)
    }

    _getMessage(socketID) {
        let mesForSocket = this.messages.get(socketID);
        if (mesForSocket === void 0 || mesForSocket.length === 0) {
            return false
        }

        return mesForSocket.shift()
    }
    
    addMessage(socketID, message, seq) {
        return this.mutex.runExclusive(() => {
                this._addMessage(socketID, message, seq)
        })    
    }

    async getMessage(socketID, checkInterval) {
        const res = await this.mutex.runExclusive(() => {
            return this._getMessage(socketID)
        })

        if (res !== false) {
            return res;
        } 

        return new Promise((resolve) => {
            const intervalID = setInterval(async (socketID) => {
                const res = await this.mutex.runExclusive(() => {
                    return this._getMessage(socketID)
                })
                if (res !== false) {
                    clearInterval(intervalID)
                    resolve(res)
                }
            }, checkInterval, socketID)
        })       
    }
}

module.exports.MessageStore = MessageStore;