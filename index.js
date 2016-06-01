'use strict';

var fs = require('fs'),
  path = require('path'),
  File = require('vinyl'),
  vfs = require('vinyl-fs'),
  concat = require('concat-stream'),
  utils = require('documentation-theme-utils'),
  hljs = require('highlight.js'),
  Handlebars = require('handlebars'),
  getDoc = require('globals-docs').getDoc,
  remark = require('remark'),
  html = require('remark-html'),
  inlineLex = require('jsdoc-inline-lex');

/**
 * Format link & tutorial tags with simple code inline tags.
 *
 * @param {Array<string>} paths potential linkable namepaths
 * @param {string} text input - typically a description
 * @returns {string} markdown-friendly output
 * @private
 * @example
 * formatInlineTags('{@link Foo}'); // "[Foo](#foo)"
 */
function formatInlineTags(paths, text) {
  var output = '';
  var tokens = inlineLex(text);

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'text') {
      output += tokens[i].capture[0];
    } else if (tokens[i].type === 'link') {
      var described = tokens[i].capture[1].match(/([^\s|\|]*)(\s|\|)(.*)/);
      if (described) {
        // 1 is the match, 3 is description
        output += autolink(paths, described[1], described[3]);
      } else {
        output += autolink(paths, tokens[i].capture[1]);
      }
    } else if (tokens[i].type === 'prefixLink') {
      output += autolink(paths, tokens[i].capture[1], tokens[i].capture[2]);
    }
  }

  return output;
}

/**
 * Link text to this page or to a central resource.
 * @param {Array<string>} paths list of valid namespace paths that are linkable
 * @param {string} text inner text of the link
 * @returns {string?} potentially a url
 */
function getNamedLink(paths, text) {
  if (paths.indexOf(text) !== -1) {
    return '#' + text;
  } else if (getDoc(text)) {
    return getDoc(text);
  }
}

/**
 * Link text to this page or to a central resource.
 * @param {Array<string>} paths list of valid namespace paths that are linkable
 * @param {string} text inner text of the link
 * @param {string} description link text override
 * @returns {string} potentially linked HTML
 */
function autolink(paths, text, description) {
  var url = getNamedLink(paths, text);
  if (url) {
    return '<a href="' + url + '">' + (description || text) + '</a>';
  }
  return text;
}

/**
 * Format a parameter name. This is used in formatParameters
 * and just needs to be careful about differentiating optional
 * parameters
 *
 * @param {Object} param a param as a type spec
 * @returns {string} formatted parameter representation.
 */
function formatParameter(param) {
  return (param.type && param.type.type === 'OptionalType') ?
  '[' + param.name + ']' : param.name;
}

/**
 * Format the parameters of a function into a quickly-readable
 * summary that resembles how you would call the function
 * initially.
 *
 * @returns {string} formatted parameters
 */
function formatParameters() {
  if (!this.params) {
    return '';
  }
  return '(' + this.params.map(function (param) {
    return formatParameter(param);
  }).join(', ') + ')';
}

var htmlOptions = {
  entities: false
};

module.exports = function (comments, options, callback) {

  var pageTemplate = Handlebars.compile(fs.readFileSync(path.join(__dirname, 'index.hbs'), 'utf8'));

  var hljsOptions = options.hljs || {};
  hljs.configure(hljsOptions);


  Handlebars.registerPartial('section',
    Handlebars.compile(fs.readFileSync(path.join(__dirname, 'section.hbs'), 'utf8'), {
      preventIndent: true
    })
  );

  var paths = comments.map(function (comment) {
    return comment.path.join('.');
  }).filter(function (path) {
    return path;
  });

  Handlebars.registerHelper('permalink', function () {
    return this.path.join('.');
  });

  Handlebars.registerHelper('name_', function () {
    var memberof = options.name.split( '.' )[ 0 ];
    var name = this.name;
    if ( this.memberof === memberof )
      while ( name.indexOf( '_' ) !== -1 )
        name = name.replace( '_', ' ' );
    return name;
  });

  Handlebars.registerHelper('name_split', function () {
    return options.name.split( '.' )[ 0 ];
  } );

  Handlebars.registerHelper('even_row', function ( conditional ) {
    if ( conditional % 2 === 0 )
      return 'bg-odd';
    else
      return 'bg-even';
  } );

  Handlebars.registerHelper('if_not_function', function ( opts ) {
    if ( this.kind !== 'function' )
      return opts.fn(this);
    else
        return opts.inverse(this);
  } );

  Handlebars.registerHelper('autolink', function (text) {
    return autolink(paths, text);
  });

  Handlebars.registerHelper('format_params', formatParameters);

  Handlebars.registerHelper('if_eq', function(a, b, opts) {
      if(a == b) // Or === depending on your needs
          return opts.fn(this);
      else
          return opts.inverse(this);
  });

  /**
   * This helper is exposed in templates as `md` and is useful for showing
   * Markdown-formatted text as proper HTML.
   *
   * @name formatMarkdown
   * @param {string} string
   * @returns {string} string
   * @example
   * var x = '## foo';
   * // in template
   * // {{ md x }}
   * // generates <h2>foo</h2>
   */
  Handlebars.registerHelper('md', function formatMarkdown(string) {
    return new Handlebars.SafeString(remark().use(html, htmlOptions)
        .process(formatInlineTags(paths, string)));
  });

  Handlebars.registerHelper('format_type', function (type) {
    if ( type !== undefined ) {
      var type_str; 
      if ( type.name !== undefined )
        type_str = type.name.toLowerCase();
      else
        type_str = type.expression.name.toLowerCase();
      var formatted = remark().use(html, htmlOptions)
        .stringify({
          type: 'root',
          children: utils.formatType(type, paths)
        });
      return '<span class="type-hint type-hint-' + type_str + '">' + formatted + '</span>';
    }
  });

  // Handlebars.registerHelper('format_type', function (type) {
  //   return remark().use(html, htmlOptions)
  //     .stringify({
  //       type: 'root',
  //       children: utils.formatType(type, paths)
  //     });
  // });

  Handlebars.registerHelper('highlight', function (example) {
    if (hljsOptions.highlightAuto) {
      return hljs.highlightAuto(example).value;
    }
    return hljs.highlight('js', example).value;
  });

  // push assets into the pipeline as well.
  vfs.src([__dirname + '/assets/**'], { base: __dirname })
    .pipe(concat(function (files) {
      callback(null, files.concat(new File({
        path: 'index.html',
        contents: new Buffer(pageTemplate({
          docs: comments,
          options: options
        }), 'utf8')
      })));
    }));
};
