import Ember from 'ember';
import moment from 'moment';

var millisecond = 1;
var second = millisecond*1000;
var minute = second*60;
var hour = minute*60;
//var day = hour*24;

var UpdateStatus = Ember.Object.extend({
	setStatus: function(status) {
		switch(status) {
			case window.applicationCache.UNCACHED:
				this.set('progress', undefined);
				this.set('status', 'uncached');
				break;
			case window.applicationCache.IDLE:
				this.set('progress', undefined);
				this.set('status', 'idle');
				break;
			case window.applicationCache.CHECKING:
				this.set('progress', undefined);
				this.set('status', 'checking');
				break;
			case window.applicationCache.DOWNLOADING:
				this.set('status', 'downloading');
				break;
			case window.applicationCache.UPDATEREADY:
				this.set('progress', undefined);
				this.set('status', 'update_ready');
				break;
			case window.applicationCache.OBSOLETE:
				this.set('progress', undefined);
				this.set('status', 'obsolete');
				break;
			case 'unsupported':
				this.set('progress', undefined);
				this.set('status', 'unsupported');
				break;
			default:
				this.set('progress', undefined);
				Ember.Logger.error('[application-cache]', 'Unknown status:', status);
				this.set('status', status);
				break;
		}
		this.set('lastChange', moment());
		Ember.Logger.debug('[application-cache]', 'New status:', this.get('status'));
	},

	setProgress: function(progress) {
		if(this.get('status') !== 'downloading') {
			throw "Can not set progress while in any state other than downloading.";
		}

		this.set('progress', progress);
	}
});

var applicationCacheEvents = ['checking', 'downloading', 'progress', 'error', 'obsolete', 'cached', 'noupdate', 'updateready'];

export default Ember.Controller.extend({
	checkInterval: 1*hour+5*minute,
	checkInaccuracy: 30*minute, // We give it some inaccuracy so that clients don't flood requests at the same time.

	_checkSupport: function() {
		this.set('status', UpdateStatus.create());
		this.set('supported', window.applicationCache != null);
		if(!this.get('supported')) {
			Ember.Logger.warn('[application-cache]', 'Not supported');
		}
	}.on('init'),

	_updateStatus: function(e) {
		var status = this.get('status');


		if(e != null && e.type != null) {
			Ember.Logger.debug('[application-cache]', 'event:', e.type, e);
			switch(e.type) {
				case 'noupdate':
					status.setStatus(window.applicationCache.status);
					this.set('lastCheck', moment());
					break;
				case 'downloading':
					status.setStatus(window.applicationCache.DOWNLOADING);
					status.setProgress(undefined);
					break;
				case 'progress':
					if(e.lengthComputable) {
						status.setProgress(e.loaded/e.total);
					} else {
						status.setProgress(undefined);
					}
					break;
				case 'error':
					status.setStatus(window.applicationCache.status);
					Ember.Logger.error('[application-cache]', 'error:', e.message);
					if(window.applicationCache.status === window.applicationCache.IDLE) {
						this.set('lastCheck', moment());
					}
					break;
				default:
					status.setStatus(window.applicationCache.status);
					break;
			}
		} else {
			status.setStatus(window.applicationCache.status);
		}
	},

	nextCheck: function() {
		var lastCheck = this.get('lastCheck');
		if(lastCheck == null) {
			return;
		}

		var nextCheck = moment(lastCheck).add(this.checkInterval+(Math.random()*this.checkInaccuracy));
		Ember.Logger.debug('[application-cache]', 'Next update check at', nextCheck.format());
		return nextCheck;
	}.property('lastCheck'),

	_setClock: function() {
		this._cancelClock();

		var nextCheck = this.get('nextCheck');
		if(nextCheck == null) {
			return;
		}

		this.set('timer', Ember.run.later(this, this.checkForUpdates, nextCheck.diff()));
	}.observes('nextCheck'),

	_cancelClock: function() {
		var timer = this.get('timer');
		if(timer != null) {
			Ember.Logger.debug('[application-cache]', 'Update timer canceled');
			Ember.run.cancel(timer);
			this.set('timer', undefined);
		}
	}.on('willDestroy'),

	_teardownEventListeners: function() {
		if(this._updateStatusClosure != null) {
			for(var i = 0; i < applicationCacheEvents.length; i++) {
				Ember.Logger.debug('[application-cache]', 'Removed listener for', applicationCacheEvents[i]);
				window.applicationCache.removeEventListener(applicationCacheEvents[i], this._updateStatusClosure, false);
			}

			delete this._updateStatusClosure;
		}
	}.on('willDestroy'),

	checkForUpdates: function() {
		if(!this.get('supported')) {
			throw "Application cache not supported";
		}

		window.applicationCache.update();
	},

	_setupEventListeners: function() {
		if(!this.get('supported')) {
			this.get('status').setStatus('unsupported');
			return;
		}

		this._updateStatusClosure = this._updateStatus.bind(this);

		for(var i = 0; i < applicationCacheEvents.length; i++) {
			Ember.Logger.debug('[application-cache]', 'Added listener for', applicationCacheEvents[i]);
			window.applicationCache.addEventListener(applicationCacheEvents[i], this._updateStatusClosure, false);
		}

		this._updateStatus();
	}.observes('supported')
});
