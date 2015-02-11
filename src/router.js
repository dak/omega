import csp from 'js-csp';
import Stream from './stream';

let defaultRoute  = /.*/,
    rootRoute     = /^\/$/,
    optionalParam = /\((.*?)\)/g,
    namedParam    = /(\(\?)?:\w+/g,
    splatParam    = /\*\w+/g,
    escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

const REGISTER = Symbol();

class Route extends Stream {

    constructor (url, router) {
        super();

        this.ch = router[REGISTER](url);
    }

    load (page, options) {
        let self = this;

        csp.go(function* () {
            while (true) {
                var route = yield csp.take(self.ch);
                // get parts of route... /path/:id/:name
                // pass captured parts in to functions using spread operator

                if (typeof page === 'string') {
                    System.import(page).then(function (m) {
                        let page = new m.default(options);
                        page.render();
                    });
                } else if (typeof page === 'function') {
                    page(route);
                } else if (page && typeof page.load === 'function') {
                    page.load(route);
                } else if (typeof page !== 'undefined') {
                    throw new TypeError('Tried to load an invalid type.');
                }
            }
        });

        // should this create a new instance of Route of something similar and return that
        // with a new channel to allow chaining loads?
        // should there be a different method?
        // can i use alts to make load listen to a couple channels to make this work?
        return this;
    }

}

const CONVERT_ROUTE = Symbol();

export default class Router extends Stream {

    constructor () {
        super();

        this.ch = csp.chan();

        this[REGISTER] = (function (ch) {
            let channels = new Map();

            csp.go(function* () {
                while (true) {
                    let val = yield csp.take(ch);

                    for (let [chan, url] of channels) {
                        if (url.test(val)) {
                            yield csp.put(chan, val);
                            break;
                        }
                    }
                }
            });

            return function (url) {
                let ch = csp.chan(/*csp.buffers.dropping(1)*/);
                channels.set(ch, url);
                return ch;
            }
        })(this.ch);

        this.init.apply(this, arguments);

        // this.route('path').goto(login).goto(page).load(view1, view2, view3)
        // goto pauses execution before calling the next
        // load executes immediately
    }

    init () {}

    route (route) {
        if (!(route instanceof RegExp)) route = this[CONVERT_ROUTE](route);
        return new Route(route, this);
    }

    default () {
        return new Route(defaultRoute, this);
    }

    root () {
        return new Route(rootRoute, this);
    }

    start (options = {}) {
        let self = this;

        if (!options.silent) {
            csp.go(function* () {
                yield csp.put(self.ch, window.location.pathname);
            });
        }

        return this;
    }

    stop () {
        return this;
    }

    navigate (url, options = {}) {
        let self = this;

        if (options.replace) {
            history.replaceState(options.state || null, document.title, url);
        } else {
            history.pushState(options.state || null, document.title, url);
            csp.go(function* () {
                yield csp.put(self.ch, url);
            });
        }

        return this;
    }

    // Internal Methods

    [CONVERT_ROUTE] (route) {
        route = route.replace(escapeRegExp, '\\$&')
                     .replace(optionalParam, '(?:$1)?')
                     .replace(namedParam, (match, optional) => optional ? match : '([^/?]+)')
                     .replace(splatParam, '([^?]*?)');

       return new RegExp(`^\/${route}`);
    }

}
