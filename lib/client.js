/**
 * "THE BEER-WARE LICENSE" (Revision 42):
 * <malte@cybaer.ninja> wrote this file. As long as you retain this notice you
 * can do whatever you want with this stuff. If we meet some day, and you think
 * this stuff is worth it, you can buy me a beer in return Malte Heinzelmann
**/

const process = require("process");
const puppeteer = require("puppeteer");
const uuid = require("uuid4");

function Client(socket, queue, host) {
    (async function (queue) {
        this.whitelist = [];
        this.inNavigation = false;
        this.shouldUpdate = false;
        this.fromHistory = false;
        this.forceReload = false;
        this.socket = socket;
        this.isInitialized = false;
        this.permaRender = true;
        this.browser = await puppeteer.launch({
            headless: false,
            args: [
                "--no-sandbox",
                "--headless",
                "--disable-gpu",
                // "--hide-scrollbars",
                "--mute-audio"
            ]
        });
        this.mousex = 0;
        this.mousey = 0;
        this.whitelistURL({
            match: "start",
            path: `http://${host}/`,
        });
        this.whitelistURL({
            match: "start",
            path: `https://${host}/`,
        });
        this.whitelistURL({
            match: "start",
            path: "https://insinuator.net/",
        });
        // this.whitelistURL({
        //     match: "start",
        //     path: "https://www.youtube.com/",
        // });
        process.on("cleanup", () => {
            console.log("cleanup", this.socket.id);
            this.browser.close();
        });
        socket.on("init", async (width, height, url) => {
            if (!this.isInitialized) {
                return;
            }
            await this.open(url, false);
            await this.resize(width, height);
        });
        socket.on("event", async e => {
            if (!this.isInitialized) {
                return;
            }
            if (this.page !== undefined && this.page._client._connection !== undefined) {
                switch (e.type) {
                    case "resize":
                        await this.resize(e.width, e.height);
                        break;
                    case "mousemove":
                    case "mousedown":
                    case "mouseup":
                        await this.mouse(e.type, e.x, e.y, e.which);
                        break;
                    case "keydown":
                    case "keyup":
                        await this.key(e.type, e.key, e.which, e.code);
                        break;
                }
            } else {
                // TODO: What happened?
                console.log("dead", this.page === undefined)
            }
        });
        socket.on("alert", id => {
            if (uuid.valid(id) && this.alerts[id] === 1) {
                this.alerts[id] = 0;
            }
        });
        socket.on("confirm", (id, result) => {
            if (uuid.valid(id) && this.confirms[id] === 1) {
                this.confirms[id] = result;
            }
        });
        socket.on("prompt", (id, result) => {
            if (uuid.valid(id) && this.prompts[id] === 1) {
                this.prompts[id] = result;
            }
        });
        socket.on("url", (url) => {
            if (url === null) {
                url = "http://localhost:3000/"
            }
            if (this.page !== undefined && this.page._client._connection !== undefined) {
                this.fromHistory = true;
                this.page.goto(url)
            }
        });
        socket.on("queuepos", () => {
            socket.emit("queuepos", queue.position(this.socket.id));
        })
        this.updateInterval = setInterval(async () => {
            if (!this.inNavigation && (this.permaRender || this.shouldUpdate) && this.page !== undefined) {
                try {
                    if (this.page.target().url() !== this.page.mainFrame().url()) {
                        // console.log(this.page.target().url(), this.page.mainFrame().url());
                        return;
                    }
                    const viewport = await this.page.viewport();
                    // console.log("update");
                    this.socket.emit(
                        "update",
                        (await this.page.screenshot({
                            type: "png",
                            clip: {
                                x: await this.page.evaluate(() => { return window.scrollX; }),
                                y: await this.page.evaluate(() => { return window.scrollY; }),
                                width: viewport.width,
                                height: viewport.height
                            },
                            // fullPage: true,
                        })).toString("base64"),
                        await this.page.title(),
                        await this.page.evaluate((x, y) => {
                            let element = document.elementFromPoint(x, y);
                            if (element === undefined || element === null)
                                return "default";
                            return window.getComputedStyle(element).cursor
                        }, this.mousex, this.mousey),
                    );
                    this.shouldUpdate = false;
                } catch (e) {
                    // TODO: What happened?
                    // console.log("dead too", e, this.mousex, this.mousey)
                }
            }
        }, 50);
        socket.on("disconnect", async () => {
            queue.done(this.socket.id);
            clearInterval(this.updateInterval);
            this.alerts = {};
            this.prompts = {};
            this.confirms = {};
            await this.browser.close();
        });
        this.alerts = {};
        this.alertPollRate = 100;
        this.prompts = {};
        this.promptPollRate = 100;
        this.confirms = {};
        this.confirmPollRate = 100;
        if (await queue.enqueue(this.socket.id, socket)) {
            this.initialized();
        }
    }.bind(this))(queue);
}

Client.prototype.open = async function (url, update = true) {
    this.page = await this.browser.newPage();
    await this.page.setRequestInterception(true);
    await this.page.setExtraHTTPHeaders({
        // TODO: Add client ID for reference
        "X-From-Server": "1",
    });
    this.page.on("framenavigated", async frame => {
        if (frame.parentFrame() === null) {
            this.inNavigation = true;
            // console.log("new url", frame.url(), this.url);
            if (frame.url() !== this.url || this.forceReload) {
                // console.log("REDIRECT");
                try {
                    await this.page.goto(this.url);
                } catch (e) {
                    // this.url = frame.url();
                    console.error(e);
                }
            }
            if (!this.fromHistory) {
                this.socket.emit("url", this.url);
            }
            this.fromHistory = false;
            this.forceReload = false;
        }
    });
    this.page.on('request', async req => {
        const oldUrl = this.url;
        if (req.resourceType() === "document") {
            this.url = req.url();
        }
        // console.log("request", req.url(), req.resourceType());
        if (this.isWhitelisted(req.url())) {
            req.continue();
        } else {
            this.url = oldUrl;
            this.forceReload = true;
            req.abort();
        }
    });
    this.page.on("requestfailed", req => {
        // console.log("requestfailed", this.url, req.url(), req.failure());
    });
    this.page.on("requestfinished", req => {
        // console.log("requestfinished", req.url());
    });
    this.page.on("dialog", async dialog => {
        switch (dialog.type()) {
            case "alert":
                await this.alert(dialog.message());
                await dialog.dismiss();
                break;
            case "confirm":
                if (await this.confirm(dialog.message()) === true) {
                    await dialog.accept();
                } else {
                    await dialog.dismiss();
                }
                break;
            case "prompt":
                const result = await this.prompt(dialog.message(), dialog.defaultValue());
                if (result === null) {
                    await dialog.dismiss();
                } else {
                    await dialog.accept(result);
                }
                break;
        }
    });
    this.page.on("load", async () => {
        this.shouldUpdate = true;
        this.inNavigation = false;
    });
    const response = await this.page.goto(url);
    if (response === null || response._status !== 200)
        return;
    if (update)
        await this.update();
};

Client.prototype.whitelistURL = function(url) {
    if (url === undefined) {
        url = "";
    }
    if (typeof url === typeof "") {
        url = {
            path: url,
            match: "whole"
        }
    }
    if (url.path === "") {
        return;
    }
    this.whitelist.push(url);
};

Client.prototype.isWhitelisted = function (url) {
    if (url === undefined || url === "") {
        return false;
    }
    for (let i = 0; i < this.whitelist.length; i++) {
        const allowed = this.whitelist[i];
        switch (allowed.match) {
            case "whole":
                if (allowed.path === url)
                    return true;
                break;
            case "start":
                if (url.startsWith(allowed.path))
                    return true;
                break;
            case "end":
                if (url.endsWith(allowed.path))
                    return true;
                break;
        }
    }
    return false;
};

Client.prototype.initialized = function () {
    if (this.page === undefined) {
        this.isInitialized = true;
        this.socket.emit("init");
        return false;
    }
    return true;
};

Client.prototype.resize = async function (width, height, update = true) {
    if (!this.initialized())
        return;
    await this.page.setViewport({
        width: width,
        height: height
    });
    if (update)
        await this.update();
};

Client.prototype.mouse = async function (event, x, y, which, update = true) {
    if (!this.initialized())
        return;
    let button = which;
    if (which === 1) {
        button = "left";
    } else if (which === 2) {
        button = "middle";
    } else if (which === 3) {
        button = "right";
    }
    switch (event) {
        case "mousedown":
            await this.page.mouse.down({
                button: button
            });
            break;
        case "mouseup":
            await this.page.mouse.up({
                button: button
            });
            break;
        case "mousemove":
            this.mousex = x;
            this.mousey = y;
            await this.page.mouse.move(x, y);
            break;
    }
    if (update)
        await this.update();
};

Client.prototype.key = async function (event, key, which, code, update = true) {
    switch (event) {
        case "keydown":
            await this.page.keyboard.down(key);
            break;
        case "keyup":
            await this.page.keyboard.up(key);
            break;
    }
    if (update)
        await this.update();
};

Client.prototype.update = async function () {
    this.shouldUpdate = true;
};


Client.prototype.alert = async function (text) {
    const id = uuid();
    this.alerts[id] = 1;
    this.socket.emit("alert", id, text);
    return new Promise((resolve, reject) => {
        const i = setInterval(() => {
            if (this.alerts[id] === 1) {
                return;
            }
            clearInterval(i);
            if (this.alerts[id] === undefined) {
                reject();
            }
            resolve(false);
            delete this.alerts[id];
        }, this.alertPollRate);
    });
};

Client.prototype.confirm = async function (text) {
    const id = uuid();
    this.confirms[id] = 1;
    this.socket.emit("confirm", id, text);
    return new Promise((resolve, reject) => {
        const i = setInterval(() => {
            if (this.confirms[id] === 1) {
                return;
            }
            clearInterval(i);
            if (this.confirms[id] === undefined) {
                reject();
            }
            resolve(this.confirms[id]);
            delete this.confirms[id];
        }, this.confirmPollRate);
    });
};

Client.prototype.prompt = async function (text, def) {
    const id = uuid();
    this.prompts[id] = 1;
    this.socket.emit("prompt", id, text, def);
    return new Promise((resolve, reject) => {
        const i = setInterval(() => {
            if (this.prompts[id] === 1) {
                return;
            }
            clearInterval(i);
            if (this.prompts[id] === undefined) {
                reject();
            }
            resolve(this.prompts[id]);
            delete this.prompts[id];
        }, this.promptPollRate);
    });
};

module.exports = Client;
