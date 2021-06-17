/**
 * 
 */

let ReservedWords = ['abstract',
	'arguments',
	'await*',
	'boolean',
	'break',
	'byte',
	'case',
	'catch',
	'char',
	'class*',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'double',
	'else',
	'enum*',
	'eval',
	'export*',
	'extends*',
	'false',
	'final',
	'finally',
	'float',
	'for',
	'function',
	'goto',
	'if',
	'implements',
	'import*',
	'in',
	'instanceof',
	'int',
	'interface',
	'let*',
	'long',
	'native',
	'new',
	'null',
	'package',
	'private',
	'protected',
	'public',
	'return',
	'short',
	'static',
	'super*',
	'switch',
	'synchronized',
	'this',
	'throw',
	'throws',
	'transient',
	'true',
	'try',
	'typeof',
	'var',
	'void',
	'volatile',
	'while',
	'with',
	'yield',
	'Array',
	'Date',
	'hasOwnProperty',
	'Infinity',
	'isFinite',
	'isNaN',
	'isPrototypeOf',
	'length',
	'Math',
	'NaN',
	'name',
	'Number',
	'Object',
	'prototype',
	'String',
	'toString',
	'undefined',
	'valueOf',
	'getClass',
	'java',
	'JavaArray',
	'javaClass',
	'JavaObject',
	'JavaPackage',
	'alert',
	'all',
	'anchor',
	'anchors',
	'area',
	'assign',
	'blur',
	'button',
	'checkbox',
	'clearInterval',
	'clearTimeout',
	'clientInformation',
	'close',
	'closed',
	'confirm',
	'constructor',
	'crypto',
	'decodeURI',
	'decodeURIComponent',
	'defaultStatus',
	'document',
	'element',
	'elements',
	'embed',
	'embeds',
	'encodeURI',
	'encodeURIComponent',
	'escape',
	'event',
	'fileUpload',
	'focus',
	'form',
	'forms',
	'frame',
	'innerHeight',
	'innerWidth',
	'layer',
	'layers',
	'link',
	'location',
	'mimeTypes',
	'navigate',
	'navigator',
	'frames',
	'frameRate',
	'hidden',
	'history',
	// 'image',
	// 'images',
	'offscreenBuffering',
	'open',
	'opener',
	'option',
	'outerHeight',
	'outerWidth',
	'packages',
	'pageXOffset',
	'pageYOffset',
	'parent',
	'parseFloat',
	'parseInt',
	'password',
	'pkcs11',
	'plugin',
	'prompt',
	'propertyIsEnum',
	'radio',
	'reset',
	'screenX',
	'screenY',
	'scroll',
	'secure',
	'select',
	'self',
	'setInterval',
	'setTimeout',
	'status',
	'submit',
	'taint',
	'text',
	'textarea',
	'top',
	'unescape',
	'untaint',
	'window',
	'require',
	'exports',
	'module',
	'console',
	'Promise',
	'process',
	'Int8Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'Int16Array',
	'Uint16Array',
	'Int32Array',
	'Uint32Array',
	'Float32Array',
	'Float64Array'
];

let globalObjectBuiltInProperties = [
	'Infinity',
	'NaN',
	'undefined',
	'null',
	'globalThis',
	'Object',
	'Function',
	'Boolean',
	'Symbol',
	'Error',
	'EvalError',
	'InternalError', 
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'TypeError',
	'URIError',
	'Number',
	'BigInt',
	'Math',
	'Date',
	'String',
	'RegExp',
	'Array',
	'Int8Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'Int16Array',
	'Uint16Array',
	'Int32Array',
	'Uint32Array',
	'Float32Array',
	'Float64Array',
	'BigInt64Array',
	'BigUint64Array',
	'Map',
	'Set',
	'WeakMap',
	'WeakSet',
	'ArrayBuffer',
	'SharedArrayBuffer', 
	'Atomics', 
	'DataView',
	'JSON',
	'Promise',
	'Generator',
	'GeneratorFunction',
	'AsyncFunction',
	'Reflect',
	'Proxy',
	'btoa',
	'Intl',
	'Intl.Collator',
	'Intl.DateTimeFormat',
	'Intl.ListFormat',
	'Intl.NumberFormat',
	'Intl.PluralRules',
	'Intl.RelativeTimeFormat',
	'Intl.Locale',
	'WebAssembly',
	'WebAssembly.Module',
	'WebAssembly.Instance',
	'WebAssembly.Memory',
	'WebAssembly.Table',
	'WebAssembly.CompileError',
	'WebAssembly.LinkError',
	'WebAssembly.RuntimeError'
];

let DOMBuiltinObjects = [

	'XMLHttpRequest',
	'Image',
	'Blob',
	'XMLSerializer',
	'HTMLImageElement',
	'HTMLCanvasElement',
	'HTMLVideoElement',
	'Audio'
	
];

let esBuiltinObjects = [

	'Map',
	'Set',
	'ArrayBuffer',
	'DataView'
];

let testBuiltinObjects = [

	'jasmine'
];

function isReservedWord(word) {

	return ReservedWords.some(reservedWord => {

		return reservedWord === word;
	});
}

//these lists are growing bigger and bigger
//depending on the projects analyzed (they're sth like dictionaries)
exports.ReservedWords = ReservedWords;
exports.globalObjectBuiltInProperties = globalObjectBuiltInProperties;
exports.DOMBuiltinObjects = DOMBuiltinObjects;
exports.esBuiltinObjects = esBuiltinObjects;
exports.testBuiltinObjects = testBuiltinObjects;
exports.isReservedWord = isReservedWord;