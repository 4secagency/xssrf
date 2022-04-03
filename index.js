/**
 * "THE BEER-WARE LICENSE" (Revision 42):
 * <malte@cybaer.ninja> wrote this file. As long as you retain this notice you
 * can do whatever you want with this stuff. If we meet some day, and you think
 * this stuff is worth it, you can buy me a beer in return Malte Heinzelmann
**/

const express = require("express");
const process = require("process");
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

const Queue = require("./lib/queue");
const Client = require("./lib/client");

const port = process.env.PORT || 3000;

const host = "localhost:3000";

const queue = new Queue(2);

app.use((req, res, next) => {
    res.header("Server", "Server-Side-HTML Server");
    if (req.header("X-From-Server") !== "1") {
        return res.sendFile("index.html", {
            root: "internal/",
            headers: {
                // "": ""
            }
        });
    }
    next();
});

app.use(express.static("public"));

io.on('connection', socket => {
    socket._client = new Client(socket, queue, host);
});

process.on('SIGINT', () => {
    process.exit(2);
});

process.on('exit', () => {
    process.emit('cleanup');
});

server.listen(port, () => console.log(`Appliance started on port ${port}!`));
