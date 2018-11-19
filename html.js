const Invocable = require("@aboutweb/irrigable-invoc");
const { Transform } = require('stream');
const cheerio = require('cheerio');
const path = require("path");

let hasProtocol = /^[a-z]+?:/i;
let onlyMeta = /^([?].*?)?(#.*)?$/i;

function toUrl(value, base) {
  if(
    hasProtocol.test(value)
    || onlyMeta.test(value)
  ) {
    return value;
  }

  if(path.isAbsolute(value)) {
    return path.join(base, value.slice(1));
  }

  return path.join(base, value);

};

const urlAttributes = [
  {
    attribute : "href",
    handler : toUrl
  }, {
    attribute : "srcsset",
    handler(value, cwd, base) {
      return value.replace(/[\t\r\n]/g, "").split(/[,]/g).map((rule) => {
        let [src, ratio] = rule.split(" ");

        return toUrl(src, cwd, base)+" "+ratio;
      }).join(",");
    }
  }, {
    selector : 'input[type="image"], [src]',
    attribute : 'src',
    handler : toUrl
  }
];

class HTMLStream extends Transform {
  constructor({ elements, options = {} }, parent) {
    super({
      objectMode : true
    });

    this.elements = elements;
    this.options = options;
    this.parent = parent;
  }
  _transform(vinyl, encoding, callback) {
    if (vinyl.isNull()) {
      return callback(null, vinyl);
    }

    if (vinyl.isStream()) {
      return callback(new TypError('gulp-html does not support streaming!'));
    }

    let promise = Promise.resolve();

    let doc = cheerio.load(
      vinyl.contents.toString(),
      this.options
    );

    let base = path.dirname(vinyl.relative).replace(/^[.]$/, "");

    urlAttributes.forEach(({handler, attribute, selector}) => {
      doc(`${selector || "["+attribute+"]"}`).each((i, elem) => {
        elem.attribs[attribute] = handler(elem.attribs[attribute], base);
      });
    });

    this.elements.forEach(factory => {
      promise = promise.then(() => {
        let ctx = new factory(vinyl, this);
        let selector = ctx.selector || factory.selector;
        let queue = [];

        doc(selector).each((index, node) => {
          queue.push(
            Promise.resolve(
              ctx.handle(cheerio(node), vinyl)
            )
          );
        });

        let promiseQueue = Promise.all(queue);

        if(ctx.complete) {
          promiseQueue = promiseQueue.then(() => Promise.resolve(ctx.complete()))
        }

        return promiseQueue;
      });
    });

    promise.then(() => {
      let html = doc.html();

      callback(
        null,
        Object.assign(vinyl, {
          extname : ".html",
          contents : new Buffer(html)
        })
      );
    });
  }
}

module.exports = HTMLStream;
