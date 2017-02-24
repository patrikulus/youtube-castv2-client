var util = require('util');
var castv2Cli = require('castv2-client');
var RequestResponseController = castv2Cli.RequestResponseController;
var Q = require('q');
var _ = require('lodash');
var needle = require('needle');

var utils = require('./utils');


var needleGetQ = Q.denodeify(needle.get);
var needlePostQ = Q.denodeify(needle.post);

function YoutubeController(client, sourceId, destinationId) {
    RequestResponseController.call(this, client, sourceId, destinationId, 'urn:x-cast:com.google.youtube.mdx');
    this.once('close', onclose);
    var self = this;

    this.screenId = null;
    this.xsrfToken = null;
    this.loungeToken = null;
    this.sId = null;
    this.gSessionId = null;
    this.playlistId = null;
    this.nowPlayingId = null;
    this.firstVideo = null;
    this.prevVideo = null;

    function onclose() {
        self.stop();
    }
}

util.inherits(YoutubeController, RequestResponseController);

YoutubeController.prototype._inSession = function () {
    return !_.isNull(this.gSessionId) && !_.isNull(this.sId) && !_.isNull(this.loungeToken);
};


YoutubeController.prototype.load = function (videoId, callback) {
    if (!this._inSession()) {
        // TODO use current session's playlist
        this.terminateSession();

    }
    this.loadWithNewSession(videoId, callback);
};

YoutubeController.prototype.terminateSession = function () {

    console.log('Trying to terminate session for video: ' + this.prevVideo);
    var params = utils.terminateSessionParams(this.loungeToken, this.prevVideo, this.gSessionId, this.sId);
    return needlePostQ(utils.YOUTUBE_PLAYIST_REQUEST + params, '');

};

YoutubeController.prototype.loadWithNewSession = function (videoId, callback) {

    var that = this;
    if (!_.isFunction(callback)) {
        callback = _.noop;
    }

    var controlRequestQ = Q.nbind(this.controlRequest, this);


    var sId, gSessionId, playlistId, nowPlayingId, firstVideo;
    // 1. Fetch screen ID
    controlRequestQ(
        {
            type: 'getMdxSessionStatus'
        })
        .then(function (response) {
            that.screenId = _.get(response, 'data.screenId', null);
            if (_.isNull(that.screenId)) {
                throw 'Failed to fetch screenID';
            }
        })
        .then(function () {
            // 2. Fetch page to extract XSRF token
            var youtubeUrl = utils.getYouTubeUrl(videoId);
            return needleGetQ(youtubeUrl);
        })
        .then(function (response) {
            // 3. Extract XSRF token
            var body = response[1];
            var match = utils.XsrfTokenRegex.exec(body);
            // if (match.length >= 1) {
            //     throw 'Failed to extract XSRF token';
            // }
            that.xsrfToken = match[1];
        })
        .then(function () {
            // 4. Get Lounge ID
            return needlePostQ(utils.YOUTUBE_LOUNGE_REQUEST, utils.getYouTubeLoungeTokenRequest(that.screenId, that.xsrfToken))
                .then(function (response) {

                    var screens = response[1];
                    that.screenId = _.get(screens, 'screens[0].screenId');
                    that.loungeToken = _.get(screens, 'screens[0].loungeToken');
                })

        })
        .then(function () {
            // 5. Get Session params
            var params = utils.getSessionParams(that.loungeToken);
            return needlePostQ(utils.YOUTUBE_PLAYIST_REQUEST + params, '')
                .then(function (response) {
                    that.playlistId = utils.playListIdRegex.exec(response)[1];
                    that.sId = utils.sIdRegex.exec(response)[1];
                    that.gSessionId = utils.gSessionIdRegex.exec(response)[1];
                    try {
                        that.firstVideo = utils.firstVideoRegex.exec(response)[1];
                    } catch (err) {
                        //noop
                    }
                    try {
                        that.nowPlayingId = utils.nowPlayVideoRegex.exec(response)[1];
                    } catch (err) {
                        //noop
                    }
                });

        })
        .then(function () {
            // TODO If playlist has a video active... clear it
            // 6. Add video to playlist
            var params = utils.setPlayListParams(that.loungeToken, videoId);
            return needlePostQ(utils.YOUTUBE_PLAYIST_REQUEST + params, 'count=0');
        })
        .catch(function (err) {

            console.log('Failed to play due to: ' + err);
            callback(err);
        });

    return callback(null);
};

YoutubeController.prototype.controlRequest = function (data, callback) {

    var self = this;

    function onmessage(response) {

        self.removeListener('message', onmessage);

        if (response.type === 'INVALID_REQUEST') {
            return callback(new Error('Invalid request: ' + response.reason));
        }

        callback(null, response);
    }

    this.on('message', onmessage);
    this.send(data);
};

module.exports = YoutubeController;
