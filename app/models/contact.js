import DS from 'ember-data';

var Contact = DS.Model.extend({
	accounts: DS.hasMany('account'),

	name: DS.attr('string'), // Contact's display name
	avatar: DS.attr('string'), // data: avatar
	subscription: DS.attr('string'),

	resources: DS.hasMany('resource'),

	messages: DS.hasMany('message')
});

/*var michaelAvatar = 'data:image/jpeg;base64,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';
var placeholderAvatar = 'data:image/gif;base64,R0lGODdhWgBaAOMAAMzMzJaWlr6+vpycnKOjo8XFxbe3t7GxsaqqqgAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAAWgBaAAAE/hDISau9OOvNu/9gKI5kaZ5oqq5s675wLM90bd94ru987//AoHBILBqPyKRyyWw6n9CodEqtWq/YrHbL7Xq/4LB4TC4vBYMAoSApEAIIEFrNBrjhxAHBoJcQBgYBBx96fAR+gIJCAgECAIEFBQEGAAgDHoyOkJKUlouNjwEFmaEVAQEApxSkkKyoQZIEcwCMbJCrgqATsbO1oXVAB6d4vrcUCHgVwqdxxaJDBcKOrhaBlBbRoNTQA3F2k5WXFX+H2N1t4J5Df8B/gYMUgYzXFOwT7orrjrtv3hRqAN5YkEXhjj8zCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePDSBDihxJsqTJkyiFRAAAOw==';

Contact.reopenClass({
	FIXTURES: [
		{id: 'michael@nightexcessive.us', name: 'NightExcessive', avatar: michaelAvatar},
		{id: 'test@nightexcessive.us', name: 'Test Account', avatar: placeholderAvatar}
	]
});*/

export default Contact;
