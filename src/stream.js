import csp from 'js-csp';

export default class Stream {

    constructor () {}

    /*load () {

        return this;
    }

    spawn () {
        // spawn a web worker

        return this;
    }

    listen (el, event) {
        let ch = csp.chan(),
            callback = e => csp.putAsync(ch, e);

        el = Array.isArray(el) ? el : [el];

        for (let i=0, len=el.length; i < len; i++) {
            el[i].addEventListener(event, callback);
            //this._eventListeners.push({el: el[i], event: event, callback: callback});
        }

        //this._listenChannels.push(ch);

        return ch;
    }

    listenTo (map, method, combine) {
        if (!(map instanceof Map)) return super(...arguments);

        map.forEach(function (events, obj) {
            let channels = [];

            method = typeof method === 'string' ? this[method].bind(this) : method.bind(this);
            events = Array.isArray(events) ? events : [events];

            for (let [index, event] of events.entries()) {
                channels.push(this.listen(obj, event));
            }

            if (combine) {
                method(channels);
            } else {
                method(...channels);
            }
        }, this);

        /*

        this.listenTo(new Map[
            object1: [events],
            object2: [events],
            ...
        ], this.function, combine?);

        function ([allChannels]) // if combine is true

        function ([object1Channels], [object2Channels]...) // if combine is false

        */
    //}

}
