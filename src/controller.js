import csp from 'js-csp';
import Stream from './stream';

/*

Built-in Property Binders

value
text
html
class
checked
*

Wild-card Property Binder

If a property cannot be found in the defined binders it defaults to __attr__. __attr__ is a special binder that look up the property in the elements attributes. This is useful for binding to a wide variety attributes like data-custom and other custom attributes you need.

bindings: {
    'text h1.name': 'name',
    'value input[name="name"]': 'name',
    'html .content': {property: 'content', set: (content) => content.trim()}
};

*/

let delegateEventSplitter = /^(\S+)\s*(.*)$/;

class Region {

    constructor (el, parent) {
        this.parent = parent;
        this.controllers = [];

        if (typeof el === 'string') {
            this.el = document.querySelector(el);
        } else {
            this.el = el;
        }
    }

    show (controller) {
        this.empty();
        return this.append(controller);
    }

    append (controller) {
        if (typeof controller === 'function') {
            controller = new controller({noRender: true});
        }

        controller.parent = this.parent;
        this.controllers = this.controllers || [];
        this.controllers.push(controller);
        this.el.appendChild(controller.setElement());
        controller.render();

        return controller;
    }

    empty () {
        for (let i = 0, len = this.controllers.length; i < len; i++) {
            this.controllers[i].close();
        }

        while (this.el && this.el.firstChild) {
            this.el.removeChild(this.el.firstChild);
        }

        delete this.controllers;
    }

    close () {
        this.empty();
        delete this.el;
        delete this.parent;
    }

}

class Regions {

    constructor (regions = {}, controller) {
        let keys = Object.keys(regions);

        for (let i = 0, len = keys.length; i < len; i++) {
            this[keys[i]] = new Region(regions[keys[i]], controller);
        }

        this.self = new Region(controller.el, controller);
    }

}

// FIX: Are events lost on re-render since they're on DOM elements being replaced, not on the top-level element?

// Internal Methods
const RENDER = Symbol();
const GET_TEMPLATE = Symbol();
const GET_TEMPLATE_DATA = Symbol();
const RECONCILE_DOM = Symbol();
const CREATE_CHANNEL = Symbol();

// Internal Properties
const EVENT_LISTENERS = Symbol();
const CHANNEL_EVENTS = Symbol();
const CHANNELS = Symbol();
const BINDINGS = Symbol();

export default class Controller extends Stream {

    constructor (options = {}) {
        super();

        this[EVENT_LISTENERS] = [];
        this[CHANNEL_EVENTS] = [];
        this[CHANNELS] = [];
        this[BINDINGS] = [];

        let viewOptions = ['el', 'id', 'classes', 'model', 'events', 'channels', 'bindings'];

        for (let i = 0, len = viewOptions.length; i < len; i++) {
            let property = viewOptions[i],
                option = options[property] || this[property];

            if (typeof option === 'function') {
                this[property] = option.apply(this);
            } else if (option !== undefined) {
                this[property] = option;
            }
        }

        this.init.apply(this, arguments);

        this.setElement(this.el);
        if (!options.noRender) { this.render(); }
        this.regions = new Regions(this.regions, this);

        this.setup.apply(this, arguments);
    }

    init () {}
    setup () {}

    [GET_TEMPLATE] () {
        if (typeof this.template === 'function') {
            return this.template(this[GET_TEMPLATE_DATA]());
        }

        return this.template;
    }

    [GET_TEMPLATE_DATA] () {
        let data = this.model ? this.model.toJSON() : {};

        if (typeof this.templateHelpers === 'function') {
            Object.assign(data, this.templateHelpers());
        } else if (typeof this.templateHelpers === 'object') {
            // Add data from template helpers to the model
            // TODO: Use better/faster iterable
            Object.keys(this.templateHelpers).forEach(function (key) {
                let value = this.templateHelpers[key];
                (typeof value === 'function') ? data[key] = value.apply(this) : data[key] = value;
            }.bind(this));
        }

        return data;
    }

    // TODO: Use Window.requestAnimationFrame() to redraw everything with only 1 redraw
    //       1 redraw every 16ms (60 fps)
    //       See: https://github.com/lhorie/mithril.js/blob/next/mithril.js
    [RECONCILE_DOM] (el, newEl) {
        parent = parent || el.parentNode;

        if (!(newEl instanceof Node)) { return; }

        // check nodeName
        if (el instanceof Node && el.nodeName === newEl.nodeName) {
            // remove attributes
            if (el.attributes) {
                for (var i=0, len=el.attributes.length; i < len; i++) {
                    if (!newEl.hasAttribute(el.attributes[i].name)) {
                        el.removeAttribute(el.attributes[i].name);
                    }
                }
            }

            // add attributes
            if (newEl.attributes) {
                for (var i=0, len=newEl.attributes.length; i < len; i++) {
                    if (el.getAttribute(newEl.attributes[i].name) !== newEl.attributes[i].value) {
                        el.setAttribute(newEl.attributes[i].name, newEl.attributes[i].value);
                    }
                }
            }

            // call recursively for each child node
            if (newEl.hasChildNodes()) {
                for (var i=j=0; i+j < newEl.childNodes.length; i++) {
                    j += reconcileDOMFast(el.childNodes[i], newEl.childNodes[i+j], el);
                }
            } else {
                el.textContent = newEl.textContent;
            }

            if (el.childNodes.length > newEl.childNodes.length-j) {
                for (var i=newEl.childNodes.length-j, len=el.childNodes.length; i < len; i++) {
                    el.childNodes[i].remove();
                }
            }

            return 0;
        } else {
            // insert newEl before el and remove el
            if (newEl && parent instanceof Node) {
                parent.insertBefore(newEl, el);
                if (el instanceof Node) { el.remove(); }
                return -1;
            }
        }

        return 0;
    }

    render () {
        this.beforeRender();
        let template = this[GET_TEMPLATE]();
        if (typeof template === 'string') {
            this.el.innerHTML = template;
            this.attachEventHandlers();
        } else {
            this[RECONCILE_DOM](this.el, template);
        }
        this.afterRender();
    }

    attachEventHandlers () {
        this.connectBindings();
        this.delegateEvents();
        this.createEventChannels();
    }

    // el.parentNode.removeChild(el);

    // Set callbacks, where `this.channels` is a Map of
    //
    // *[[callbackFunction, [event selectors]]]*
    //
    //     new Map([
    //         ['edit',      'mousedown .title'],
    //         [this.save,   'click .button'],
    //         [this.log,    ['mousedown .title', 'click .button']],
    //     ])
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly
    // and will be passed the event channels as arguments.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    createEventChannels (map) {
        map = map || this['channels'];

        if (typeof map === 'function') map = map();
        if (!map) return this;

        this.closeEventChannels();

        for (let [method, events] of map.entries()) {
            let channels = [];

            method = typeof method === 'string' ? this[method].bind(this) : method.bind(this);
            events = events instanceof Array ? events : [events];

            for (let [index, event] of events.entries()) {
                let el = this.el,
                    match = event.match(delegateEventSplitter),
                    eventName = match[1],
                    selector = match[2];

                if (selector !== '') {
                    el = el.querySelectorAll(selector);
                }

                channels.push(this[CREATE_CHANNEL](el, eventName));
            }

            method(...channels);
        }

        return this;
    }

    [CREATE_CHANNEL] (el, event) {
        let ch = csp.chan(),
            // TODO: Make preventDefault and stopProp optional
            callback = e => {
                e.preventDefault();
                e.stopPropagation();
                csp.putAsync(ch, e);
                return false;
            }

        el = el instanceof NodeList ? el : [el];

        for (let i = 0, len = el.length; i < len; i++) {
            el[i].addEventListener(event, callback);
            this[CHANNEL_EVENTS].push({el: el[i], event: event, callback: callback});
        }

        this[CHANNELS].push(ch);

        return ch;
    }

    closeEventChannels () {
        for (let i = 0, len = this[CHANNEL_EVENTS].length; i < len; i++) {
            let listener = this[CHANNEL_EVENTS][i];
            listener.el.removeEventListener(listener.event, listener.callback);
        }
        this[CHANNEL_EVENTS] = [];

        for (let i = 0, len = this[CHANNELS].length; i < len; i++) {
            this[CHANNELS][i].close();
        }
        this[CHANNELS] = [];
    }

    delegateEvents (events) {
        events = events || this['events'];

        if (typeof events === 'function') events = events();
        if (!events) return this;

        this.undelegateEvents();
        for (let key in events) {
            let method = events[key];
            if (typeof method !== 'function') { method = this[events[key]]; }
            if (!method) { continue; }

            let el = this.el,
                match = key.match(delegateEventSplitter),
                eventName = match[1],
                selector = match[2];

            if (selector !== '') {
                el = el.querySelectorAll(selector);
            }

            method = method.bind(this);
            el.addEventListener(eventName, method.bind(this));
            // FIX add event listener for every matching element
            this[EVENT_LISTENERS].push({el: el[i], event: eventName, callback: method});
        }
        return this;
    }

    undelegateEvents () {
        for (let i = 0, len = this[EVENT_LISTENERS].length; i < len; i++) {
            let listener = this[EVENT_LISTENERS][i];
            listener.el.removeEventListener(listener.event, listener.callback);
        }
        this[EVENT_LISTENERS] = [];
    }

    connectBindings () {

    }

    destroyBindings () {

    }

    setElement (el) {
        if (typeof el === 'string') {
            this.el = document.querySelector(el);
        } else {
            this.el = document.createElement(this.tag || 'div');
        }

        if (this.id) { this.el.id = id; }

        if (this.classes && this.classes.length > 0) {
            this.el.classList.add(...this.classes);
        }

        return this.el;
    }

    append (controller) {
        return this.regions.self.append(controller);
    }

    beforeRender() {}
    afterRender() {}
    beforeClose() {}

    close () {
        this.beforeClose();

        for (let i=0, len = this.regions.length; i < len; i++) {
            this.regions[i].close();
        }

        this.destroyBindings();
        this.undelegateEvents();
        this.closeEventChannels();

        delete this.el;
        delete this.regions;

        return this;
    }

}
