/**
 * "THE BEER-WARE LICENSE" (Revision 42):
 * <malte@cybaer.ninja> wrote this file. As long as you retain this notice you
 * can do whatever you want with this stuff. If we meet some day, and you think
 * this stuff is worth it, you can buy me a beer in return Malte Heinzelmann
**/

function Queue(size) {
    this.size = size;
    this.occupied = 0;
    this.waiting = {};
    this.order = [];
}

Queue.prototype.enqueue = async function (id, socket) {
    if (this.occupied < this.size) {
        this.occupied += 1;
        return true;
    }
    this.order.push(id);
    // console.log("queue", id, this.order.length);
    socket.emit("enqueued", this.order.length);
    return await new Promise(resolve => this.waiting[id] = resolve);
}

Queue.prototype.done = function (id) {
    if (this.waiting[id] !== undefined) {
        this.waiting[id](false);
        delete this.waiting[id];
        this.order.splice(this.position(id) - 1, 1);
        return;
    }
    this.occupied -= 1;
    if (this.occupied < 0) {
        this.occupied = 0;
    }
    while (this.order.length > 0) {
        const nextId = this.order.splice(0,1)[0];
        const next = this.waiting[nextId];
        if (next !== undefined) {
            return next(true);
        }
    }
}

Queue.prototype.position = function (id) {
    return this.order.indexOf(id) + 1;
}

module.exports = Queue;
