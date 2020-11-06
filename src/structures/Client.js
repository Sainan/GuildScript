const request = require('../request');
const wsManager = require('../managers/wsManager');
const EventEmitter = require('events');
const UserManager = require('../managers/UserManager');
const ChannelManager = require('../managers/ChannelManager');
const TeamManager = require('../managers/TeamManager');
const Message = require('./Message');
const Team = require('./Team');
const ClientUser = require('./ClientUser');
const cookies = Symbol();

/**
 * The main class to interact with the api.
 * @module Client
 * @example
 * const guilded = require('guildscript');
 * const client = new guilded.client();
 * 
 * client.login('email', 'password');
 * 
 * client.on('ready' () => {
 *     console.log(`Logged in as ${client.user.name}.`);
 * });
 */
module.exports = class Client extends EventEmitter {
    /**
     * Make a new client for interacting with the api.
     * @param {Object} [options] - The client options. RN we don't have any.
     */
    constructor(options) {
        super();
        this.options = options;
        /** 
         * The channels the bot can access.
         * @type {ChannelManager}
         */
        this.channels = new ChannelManager(this);
        /** 
         * The users the bot can access.
         * @type {UserManager}
         */
        this.users = new UserManager(this); 
        /** 
         * The teams the bot can access.
         * @type {TeamManager}
         */
        this.teams = new TeamManager(this); 
        this.typers = new Set();
        this.typerClocks = {};
        this[cookies] = [];

        this.on('raw', this.raw);
        this.on('connected', this.connected);
    }

    /**
     * Login to a user.
     * @param {string} email - The email of the user you want to login as.
     * @param {string} password - The password of the user you want to login as.
     */
    async login(email, password) {
        const data = JSON.stringify({ email, password });
        let { res, ok, status, cookies: cookie } = await this.request({
            data,
            path: 'login'
        });
        this[cookies] = cookie;
        if (!ok) throw new Error(`${status} error logging in!`);
        this.id = res.user.id;
        //todo data.
        this.ws = new wsManager(cookie, this);
    }

    /**
     * Disconnect and stop requests from the client.
     */
    async destroy () {
        this.ws.close();
        await this.request({path: 'logout'});
        this[cookies] = [];
    }


    ////////////////////////////////////////////////////////////
    //////////////////////INTERNAL METHODS//////////////////////
    ////////////////////////////////////////////////////////////

    /**
     * Internal function to process raw events.
     * @param {*} msg - The data to process.
     * @private
     */
    async raw(msg) {
        if (!Array.isArray(msg)) return;
        const [type, data] = msg;

        if(type === 'ChatMessageCreated') {
            this.channel = await this.channels.fetch(data.teamId, data.channelId);
            let message = new Message(this, data);
            this.emit('message', message);
        }

        if (type === 'chatMessageDeleted') {
            let { channelId, message } = data;
            let channel = this.channels.get(channelId);
            if (!channel) return;
            let msg = this.messages.get(message.id);
            if (!msg) return;
            this.emit('messageDelete', message);
        }

        if(type === 'ChatChannelTyping') {
            let key = `${data.channelId}-${data.userId}`;
            if(!this.typers.has(key)){
                this.emit('typingStart', data);
                this.typers.add(key);
            }
            clearTimeout(this.typerClocks[key]);
            this.typerClocks[key] = setTimeout(() => {
                this.emit('typingEnd', data);
                this.typers.delete(key);
                delete this.typerClocks[key];
            }, 1500);
        }
    }

    /**
     * Internal function to handle first connecting.
     * @private
     */
    async connected() {
        let data = await this.request({ path: 'me', method: 'get' });
        let me = data.res;

        this.user = new ClientUser(this, me.user);
        this.users.set(this.id, this.user);

        me.teams.forEach(async team => {
            this.teams.set(team.id, new Team(this, team));
        });

        // after thats all done fire ready
        this.emit('ready');
    }

    /**
     * Make a request to the api.
     * @param {Object} options - The options for the request.
     * @param {string} options.path - The path to go request.
     * @param {*} options.data - The data to send.
     * @param {string} [options.method='post'] - The method.
     * @param {boolean} [options.json=true] - If you want to receive a JSON response.
     * @returns {Promise<object>} The response from the server.
     * @private
     * @example
     * // get request
     * client.request({path: 'path/to/request', method: 'get'})
     * 
     * // post request
     * client.request({path: 'path/to/request', data: 'data to post'})
     */
    request(options = {}) {
        options.cookies = this[cookies];
        return request(options);
    }
};