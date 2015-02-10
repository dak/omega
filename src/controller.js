import csp from 'js-csp';
import Stream from './stream';

// TODO: Look into storing rendered html in a trie and memoizing the render function
//       http://calendar.perfplanet.com/2013/diff/
//       http://goo-apple.appspot.com/article/2e8334fc-45d1-42e2-adde-b43a17e8b12a
//       http://facebook.github.io/react/docs/reconciliation.html
//
// algorithm:
//   start from the DOM node associated with the view
//   check if the node has any children (node.hasChildNodes())
//   if it has children, recursively traverse through each node.childNodes
//     1) compare if the nodes have the same nodeName (can localName be used and is it faster?)
//          a) if not, add the new node
//     2) compare if the nodes have the same nodeValue
//          a) if not, set them equal
//     3) compare if the nodes have the same classList (or use 'class' as an attribute and just getAttribute('class'))
//          a) if not, set them equal
//     4) compare if the nodes have the same attributes and attribute values
//          a) node.attributes, iterate through each and compare with getAttribute(name) and setAttribute(name, val)


/*
Two nodes are equal if all the following conditions are true:

They have the same Node Type
They have the same nodeName, NodeValue, localName, nameSpaceURI and prefix
They have the same childNodes with all the descendants
They have the same attributes and attribute values (the attributes does not have be in the same order)
*/
// is it faster to cache some of these attributes?
/*function reconcileDOMFast(first, second, parent) {
    parent = parent || first.parentNode;

    if (!(second instanceof Node)) { return null; }

    // check nodeName
    if (first instanceof Node && first.nodeName === second.nodeName) {
        // remove attributes
        if (first.attributes) {
            for (var i=0, len=first.attributes.length; i < len; i++) {
                if (!second.hasAttribute(first.attributes[i].name)) {
                    first.removeAttribute(first.attributes[i].name);
                }
            }
        }

        // add attributes
        if (second.attributes) {
            for (var i=0, len=second.attributes.length; i < len; i++) {
                if (first.getAttribute(second.attributes[i].name) !== second.attributes[i].value) {
                    first.setAttribute(second.attributes[i].name, second.attributes[i].value);
                }
            }
        }

        // call recursively for each child node
        if (second.hasChildNodes()) {
            for (var i=j=0; i+j < second.childNodes.length; i++) {
                j += reconcileDOMFast(first.childNodes[i], second.childNodes[i+j], first);
            }
        } else {
            first.textContent = second.textContent;
        }

        if (first.childNodes.length > second.childNodes.length-j) {
            for (var i=second.childNodes.length-j, len=first.childNodes.length; i < len; i++) {
                first.childNodes[i].remove();
            }
        }

        return 0;
    } else {
        // insert second before first and remove first
        if (second && parent instanceof Node) {
            parent.insertBefore(second, first);
            if (first instanceof Node) { first.remove(); }
            return -1;
        }
    }

    return 0;
}*/

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

function config (options) {
    let viewOptions = ['el', 'model', 'events', 'sharedEvents'];

    for (let i = 0, len = viewOptions.length; i < len; i++) {
        let property = viewOptions[i],
            option = options[property] || this[property];

        if (typeof option === 'function') {
            this[property] = option.apply(this);
        } else if (option !== undefined) {
            this[property] = option;
        }
    }
}

class Region {

    constructor (el, parent) {
        if (typeof el === 'string') {
            this.el = document.querySelector(el);
        } else {
            this.el = el;
        }

        this.parent = parent;
        this.controllers = [];
    }

    show (controller) {
        this.empty();
        return this.append(controller);
    }

    append (controller) {
        if (typeof controller === 'function') {
            controller = new controller();
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

        while (this.el.firstChild) {
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

export default class Controller extends Stream {

    constructor (options = {}) {
        super();

        this._eventListeners = [];
        this._listenChannels = [];

        config.call(this, options);

        if (this.el) { this.setElement(this.el); }
        this.regions = new Regions(this.regions, this);

        this.initialize.apply(this, arguments);
        this.render.apply(this, arguments);

        this.connectBindings();
        this.delegateEvents();
        this.delegateSharedEvents();
    }

    listen (el, event) {
        let ch = csp.chan(),
            callback = e => {
                e.preventDefault();
                e.stopPropagation();
                csp.putAsync(ch, e);
                return false;
            }

        el = el instanceof NodeList ? el : [el];

        for (let i = 0, len = el.length; i < len; i++) {
            el[i].addEventListener(event, callback);
            this._eventListeners.push({el: el[i], event: event, callback: callback});
        }

        this._listenChannels.push(ch);

        return ch;
    }

    initialize () {}

    render () {
        return this;
    }

    // el.parentNode.removeChild(el);

    // Set callbacks, where `this.sharedEvents` is a Map of
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
    delegateSharedEvents (map) {
        map = map || this['sharedEvents'];

        if (typeof map === 'function') map = map();
        if (!map) return this;

        this.undelegateSharedEvents();

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

                channels.push(this.listen(el, eventName));
            }

            method(...channels);
        }

        return this;
    }

    undelegateSharedEvents () {
        for (let i = 0, len = this._eventListeners.length; i < len; i++) {
            let listener = this._eventListeners[i];
            listener.el.removeEventListener(listener.event, listener.callback);
        }
        this._eventListeners = [];

        for (let i = 0, len = this._listenChannels.length; i < len; i++) {
            this._listenChannels[i].close();
        }
        this._listenChannels = [];
    }

    delegateEvents () {}

    undelegateEvents () {}

    connectBindings () {}

    destroyBindings () {}

    setElement (el) {
        if (typeof el === 'string') {
            this.el = document.querySelector(el);
        } else {
            this.el = document.createElement(this.tag || 'div');
        }

        if (this.classes && this.classes.length > 0) {
            this.el.classList.add(...this.classes);
        }

        return this.el;
    }

    append (controller) {
        return this.regions.self.append(controller);
    }

    close () {
        for (let i=0, len = this.regions.length; i < len; i++) {
            this.regions[i].close();
        }

        this.destroyBindings();
        this.undelegateEvents();
        this.undelegateSharedEvents();

        delete this.el;
        delete this.regions;

        return this;
    }

}
