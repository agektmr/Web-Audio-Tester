/*
 * Sampling Rate: 44,100
 * Frequency:     
 * Samples
 * BufferSize
 */

var Synthesizer = (function() {
  window.AudioContext = (function() {
    return window.AudioContext ||
           window.webkitAudioContext ||
           window.mozAudioContext ||
           window.oAudioContext ||
           window.msAudioContext ||
           undefined;
  }());

  var AudioLoader = (function() {
    var cache = {}; 
    var fetch = function(srcUrl, callback, errorCallback) {
      if (typeof callback !== 'function') {
        throw Exception('callback function not specified');
      };
      var xhr = new XMLHttpRequest();
      xhr.open('GET', srcUrl, true);
      xhr.responseType = 'arraybuffer';
      cache[srcUrl] = {
        buffer: null,
        handler: xhr,
        httpStatus: null,
        state: null 
      };
      xhr.onreadystatechange = function() {
        cache[srcUrl].state = xhr.readyState;
        if (xhr.readyState == 4) {
          cache[srcUrl].httpStatus = xhr.status;
          if (xhr.status === '' || xhr.status == 200) {
            audioContext.decodeAudioData(xhr.response, function(buffer) {
              cache[srcUrl].buffer = buffer;
              cache[srcUrl].handler = null;
              cache[srcUrl].httpStatus = xhr.status;
              cache[srcUrl].state = xhr.readyState;
              callback.call(self, buffer);
            });
          } else {
            if (typeof errorCallback == 'function')
              errorCallback('File load error');
          }
        }
      };
      xhr.send();
    }
    var read = function(source, id, callback, errorCallback) {
      var reader = new FileReader();
      cache[id] = {
        buffer: null,
        handler: null,
        httpStatus: null,
        state: null 
      };
      reader.onload = function(e) {
        audioContext.decodeAudioData(e.target.result, function(buffer) {
          cache[id].buffer = buffer;
          cache[id].httpStatus = 200;
          cache[id].state = 4;
          callback.call(self, buffer);
        }, function() {
          errorCallback('You seem to load unsupported audio file.');
        });
      }
      reader.readAsArrayBuffer(source);
    }
    return {
      load: function(source, callback, errorCallback) {
//TODO: make it more simpler
        if (typeof source === 'string') {
          if (!!cache[source] && cache[source].httpStatus === 200) {
            if (typeof callback == 'function') callback(cache[source].buffer);
          } else {
            fetch(source, callback, errorCallback);
          }
        } else if (typeof source === 'object') {
          var id = source.fileName+source.lastModifiedDate;
          if (!!cache[id]) {
            if (typeof callback == 'function') callback(cache[id].buffer);
          } else {
            read(source, id, callback, errorCallback);
          }
        }
        return;
      },
      abort: function(source) {
        if (!!cache[source]) {
          cache[source].handler.abort();
          return true;
        } else {
          return false;
        }
      },
      clearCache: function() {
        cache = {};
      }
    }
  }());

  var audioContext = window.AudioContext ? new AudioContext() : null;

  var Convolver = function(audio, callback) {
    this.buffer = null;
    var self = this;
    AudioLoader.load(audio, function(buffer) {
      self.buffer = buffer;
      if (typeof callback == 'function') callback(buffer);
    });
  };

  var Synthesizer = function(audio, callback, error) {
    this.buffer = null;
    this.source = null;
    this.analyser = null;
    this.js = null;
    this.isPlaying = null;
    this.nodes = {};
    var self = this;
    AudioLoader.load(audio, function(buffer) {
      self.buffer = buffer;
      if (typeof callback == 'function') callback(buffer);
    }, function(err) {
      if (typeof error == 'function') error(err);
    });
  };
  Synthesizer.prototype = {
    addNode: function(type, params) {
      switch (type) {
      case 'BiquadFilter':
        var node = this.nodes[type] || audioContext.createBiquadFilter();
        if (params.type) node.type = params.type;
        if (params.frequency) node.frequency.value = params.frequency.value;
        break;
      case 'Convolver':
        var node = this.nodes[type] || audioContext.createConvolver();
        if (params.buffer) {
          var conv = new Convolver(params.buffer, function(buffer) {
            node.buffer = buffer;
          });
        }
        break;
      case 'Delay':
        var node = this.nodes[type] || audioContext.createDelayNode();
        if (params.delayTime) node.delayTime.value = params.delayTime.value;
        break;
      case 'DynamicsCompressor':
        var node = this.nodes[type] || audioContext.createDynamicsCompressor();
        break;
      case 'Gain':
        var node = this.nodes[type] || audioContext.createGainNode();
        if (params.gain) node.gain.value = params.gain.value;
        break;
      case 'Panner':
        var node = this.nodes[type] || audioContext.createPanner();
        if (params.panningModel) node.panningModel = params.panningModel;
        if (params.refDistance) node.refDistance = params.refDistance;
        if (params.maxDistance) node.maxDistance = params.maxDistance;
        if (params.rolloffFactor) node.rolloffFactor = params.rolloffFactor;
        break;
      case 'WaveShaper':
        var node = this.nodes[type] || audioContext.createWaveShaper();
        if (params.curve) node.curve = params.curve;
        break;
      default :
        break;
      }
      this.nodes[type] = node;
    },
    removeNode: function(type) {
      if (this.nodes[type]) delete this.nodes[type];
    },
    addAnalyser: function(drawCallback, clearCallback) {
      this.analyserDrawCallback = drawCallback;
      this.analyserClearCallback = clearCallback;
    },
    play: function() {
      var that = this;
      if (this.buffer) {
        this.source = audioContext.createBufferSource();
        var lastNode = this.source;
        for (var type in this.nodes) {
          var node = this.nodes[type];
          lastNode.connect(node);
          lastNode = node;
        }
        lastNode.connect(audioContext.destination);
        if (this.analyserDrawCallback) {
          this.analyser = audioContext.createAnalyser();
          this.analyser.smoothingTimeConstant = 0.3;
          this.js = audioContext.createJavaScriptNode(2048, 1, 1);
          this.js.onaudioprocess = function(e) {
            if (!that.analyser || !that.analyser.frequencyBinCount) return;
            var freqByteData = new Uint8Array(that.analyser.frequencyBinCount);
            that.analyser.getByteFrequencyData(freqByteData);
            that.analyserDrawCallback(freqByteData);
          };
          lastNode.connect(that.analyser);
          that.analyser.connect(this.js);
          this.js.connect(audioContext.destination);
        }
        this.isPlaying = setTimeout(function() {
          that.stop.apply(that);
        }, this.buffer.duration * 1000 + 10000);
        this.source.buffer = this.buffer;
        this.source.noteOn(0);
      } else {
console.error('buffer not ready');
      }
    },
    stop: function() {
      if (this.buffer) {
        this.source.noteOff(0);
        this.source.disconnect(0);
        if (this.analyserDrawCallback) {
          this.analyserClearCallback();
          this.analyser.disconnect(0);
          this.analyser = null;
          this.js.disconnect(0);
          this.js = null;
        }
        for (var type in this.nodes) {
          this.nodes[type].disconnect(0);
        }
      }
      clearTimeout(this.isPlaying);
      this.isPlaying = null;
    }
  };

  return function(url, callback, errorCallback) {
    if (audioContext)
      return new Synthesizer(url, callback, errorCallback);
    errorCallback('AudioContext not available');
    return null;
  }
}());
