var util = require('util');
var castv2Cli = require('castv2-client');
var RequestResponseController = castv2Cli.RequestResponseController;
var Q = require('q');
var _ = require('lodash');
var needle = require('needle');

var utils = require('./utils');

function YoutubeController(client, sourceId, destinationId) {
    RequestResponseController.call(this, client, sourceId, destinationId, 'urn:x-cast:com.google.youtube.mdx');
    this.once('close', onclose);
    var self = this;

    function onclose() {
        self.stop();
    }
}

util.inherits(YoutubeController, RequestResponseController);


YoutubeController.prototype.load = function (videoId) {
    // TODO: Implement Callback

    var controlRequestQ = Q.nbind(this.controlRequest, this);
    var needleGetQ = Q.denodeify(needle.get);
    var needlePostQ = Q.denodeify(needle.post);

    var screenId, xsrfToken, loungeToken;

    var sId, gSessionId, playlistId, nowPlayingId, firstVideo;
    controlRequestQ(
        {
            type: 'getMdxSessionStatus'
        })
        .then(function (response) {
            console.log(response);
            screenId = _.get(response, 'data.screenId', null);
            console.log('Fetched screenId: ' + screenId);
            if (_.isNull(screenId)) {
                throw 'Failed to fetch screenID';
            }
        })
        .then(function () {
            // Fetch youtube page
            var youtubeUrl = utils.getYouTubeUrl(videoId);
            return needleGetQ(youtubeUrl);
        })
        .then(function (response) {

            var body = response[1];
            var match = utils.XsrfTokenRegex.exec(body);
            xsrfToken = match[1];

        })
        .then(function () {
            // get Lounge Id
            console.log('Getting loungeId with token: ', xsrfToken, screenId);
            return needlePostQ(utils.YOUTUBE_LOUNGE_REQUEST, utils.getYouTubeLoungeTokenRequest(screenId, xsrfToken))
                .then(function (response) {

                    var screens = response[1];
                    screenId = _.get(screens, 'screens[0].screenId');
                    loungeToken = _.get(screens, 'screens[0].loungeToken');
                })

        })
        .then(function () {
            // update session params
            var params = utils.getSessionParams(loungeToken);
            return needlePostQ(utils.YOUTUBE_PLAYIST_REQUEST + params, '')
                .then(function (response) {
                    // in session params
                    console.log('in session params');
                    console.log(response);

                    playlistId = utils.playListIdRegex.exec(response)[1];
                    sId = utils.sIdRegex.exec(response)[1];
                    gSessionId = utils.gSessionIdRegex.exec(response)[1];
                    try {
                        firstVideo = utils.firstVideoRegex.exec(response)[1];
                    } catch (err) {
                        //noop
                    }
                    try {
                        nowPlayingId = utils.nowPlayVideoRegex.exec(response)[1];
                    } catch (err) {
                        //noop
                    }

                    console.log('Status response values: ', playlistId, sId, gSessionId, firstVideo, nowPlayingId);
                });

        })
        .then(function () {
            // If playlist has a video active... clear it

            // set PlayList
            var params = utils.setPlayListParams(loungeToken, videoId);
            return needlePostQ(utils.YOUTUBE_PLAYIST_REQUEST + params, 'count=0');
        })
        .catch(function (err) {
            console.log(err);
        });

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
