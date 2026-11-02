const request = require('request-promise-native');
const { URL } = require('url');
const _ = require('lodash');
const debug = require('debug');
const path = require('path');
const fs = require('fs');

const ServerError = require('./errors/ServerError');
const SessionNotFoundError = require('./errors/SessionNotFoundError');
const InvalidItemTypeError = require('./errors/InvalidItemTypeError');
const InvalidParameterError = require('./errors/InvalidParameterError');
const MissingAuthorizationError = require('./errors/MissingAuthorizationError');
const MissingAppTokenError = require('./errors/MissingAppTokenError');
const MissingAPIURLError = require('./errors/MissingAPIURLError');
const MissingHATEOASError = require('./errors/MissingHATEOASError');
const MissingItemTypeError = require('./errors/MissingItemTypeError');
const InvalidAPIURLError = require('./errors/InvalidAPIURLError');
const InvalidHTTPMethodError = require('./errors/InvalidHTTPMethodError');
const FileNotReadableError = require('./errors/FileNotReadableError');

const itemTypes = require('./itemTypes.json');
const { version } = require('./package.json');

const log = debug('glpi-api');

const HTTP_GET = 'get';
const HTTP_POST = 'post';
const HTTP_PUT = 'put';
const HTTP_DELETE = 'delete';

const userAgent = `glpi-api/${version}`;

/** Class to manage access to GLPI via REST API */
class Glpi {
  /**
   * Create a Glpi object
   *
   * Usage :
   *
   * ```
   * const Glpi = require('glpi-api');
   * const glpi = new Glpi({
   *   apiurl     : 'http://glpi.myserver.com/apirest.php',
   *   user_token : 'q56hqkniwot8wntb3z1qarka5atf365taaa2uyjrn',
   *   app_token  : 'f7g3csp8mgatg5ebc5elnazakw20i9fyev1qopya7',
   * });
   *
   * // or
   *
   * const glpi = new Glpi({
   *   apiurl     : 'http://glpi.myserver.com/apirest.php',
   *   app_token  : 'f7g3csp8mgatg5ebc5elnazakw20i9fyev1qopya7',
   *   auth       : {
   *     username : 'glpi',
   *     password : 'glpi',
   *   }
   * });
   * ```
   *
   * @param {Object} settings
   * @param {Object} settings.user_token Token used for user token authentication
   * @param {Object} settings.auth 2 parameters to login with user authentication
   * @param {Object} settings.auth.username username parameter used for user authentication
   * @param {Object} settings.auth.password password parameter used for user authentication
   * @param {Object} settings.app_token Authorization string provided by the GLPI api configuration
   * @param {Object} settings.apiurl URL of the apirest.php file
   */
  constructor(settings = {}) {
    if (!settings.user_token &&
       (!settings.auth || (!settings.auth.username || !settings.auth.password))) {
      throw new MissingAuthorizationError('Missing Authorization header');
    }

    if (!settings.app_token) {
      throw new MissingAppTokenError('Missing App-Token header');
    }

    if (!settings.apiurl) {
      throw new MissingAPIURLError('Missing API URL header');
    }

    let apiurl;
    try {
      apiurl = new URL(settings.apiurl);
    } catch (errApiurl) {
      throw new InvalidAPIURLError(`Invalid API URL ${settings.apiurl}`);
    }

    this._settings = {
      user_token : settings.user_token,
      auth       : this._getAuth(settings.auth),
      app_token  : settings.app_token,
      port       : settings.port,
      apiurl,
    };
    this._itemTypes = [...itemTypes];
    this._session = '';

    log('> SETTINGS :', this._sanitizeForLog(this._settings));
  }

  /**
   * Sanitize an object before logging to avoid exposing sensitive tokens or credentials
   *
   * @param {Object} obj
   * @returns {Object}
   * @private
   */
  _sanitizeForLog(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    const clone = { ...obj };
    if (clone.user_token) {
      clone.user_token = '***REDACTED***';
    }
    if (clone.auth) {
      clone.auth = '***REDACTED***';
    }
    if (clone.app_token) {
      clone.app_token = '***REDACTED***';
    }
    if (clone.headers) {
      clone.headers = { ...clone.headers };
      if (clone.headers['App-Token']) {
        clone.headers['App-Token'] = '***REDACTED***';
      }
      if (clone.headers['Session-Token']) {
        clone.headers['Session-Token'] = '***REDACTED***';
      }
      if (clone.headers.Authorization) {
        clone.headers.Authorization = '***REDACTED***';
      }
    }
    return clone;
  }

  /**
   * Return the appropriate string for authentication
   *
   * @param {Object} settings.auth 2 parameters to login with user authentication
   * @param {Object} settings.auth.username username parameter used for user authentication
   * @param {Object} settings.auth.password password parameter used for user authentication
   * @returns {object}
   * @private
   */
  _getAuth(auth) {
    if (auth && auth.username) {
      const username = auth.username;
      const password = auth.password;
      const base64 = Buffer.from(`${username}:${password}`).toString('base64');
      return base64;
    }
    return auth;
  }

  /**
   * Send HTTP requests
   *
   * @param {string} method HTTP method to use for the request. Only GET, POST, PUT and DELETE are accepted,
   *                        throws an InvalidHTTPMethodError otherwise.
   * @param {string} endpoint API endpoint
   * @param {object} options
   * @param {object} options.headers  HTTP headers to add to the request
   * @param {object} options.query  URL query string to add to the request
   * @returns {object}
   * @private
   */
  _request(method, endpoint, options) {
    if (![HTTP_GET, HTTP_POST, HTTP_PUT, HTTP_DELETE].includes(method)) {
      throw new InvalidHTTPMethodError(`Invalid method: ${method}`);
    }

    log('> OPTIONS IN :', this._sanitizeForLog(options));

    let headers = {
      'User-Agent'    : userAgent,
      'Cache-Control' : 'no-cache',
      'App-Token'     : this._settings.app_token,
    };

    if (this._session) {
      headers['Session-Token'] = this._session;
    }

    if (options && options.headers) {
      headers = { ...headers, ...options.headers };
      delete options.headers;
    }

    let req = {
      resolveWithFullResponse : true,
      json : true,
      baseUrl : this._settings.apiurl.href,
      url : endpoint,
      headers,
      method,
    };

    if (options) {
      if (options.query) {
        req.qs = options.query;
        delete options.query;
      }

      req = { ...req, ...options };
    }

    log('> REQUEST OPTIONS :', this._sanitizeForLog(req));

    return request(req)
    .then((incomingMessage) => {
      const range = this._parseContentRange(incomingMessage.headers);
      let response = {
        code: incomingMessage.statusCode,
        data: incomingMessage.body,
        range,
      };
      return response;
    })
    .catch((err) => {
      throw new ServerError(err);
    });
  }

  /**
   * Validate if itemType is accepted by GLPI
   *
   * @param {string} itemType itemType requested
   * @returns {boolean}
   * @private
   */
  _encodeItemType(itemType) {
    if (!itemType || typeof itemType !== 'string') {
      return itemType;
    }
    return itemType.replace(/%5c/gi, '\\').replace(/\\/g, '%5C');
  }

  _validateAndEncodeId(id) {
    if (id === null || id === undefined || id === '') {
      throw new InvalidParameterError('Missing or empty id');
    }
    const strId = String(id);
    if (strId.includes('/') || strId.includes('\\') || strId.includes('..')) {
      throw new InvalidParameterError(`Invalid id '${id}'`);
    }
    return encodeURIComponent(strId);
  }

  _validateItemType(itemType) {
    if (!itemType) {
      throw new MissingItemTypeError('Missing item type');
    }

    const availableTypes = this._itemTypes || itemTypes;
    if (availableTypes.indexOf(itemType) !== -1) {
      return true;
    }

    if (typeof itemType === 'string') {
      const normalized = itemType.replace(/%5c/gi, '\\');

      // Check GLPI 11 namespaced plugin classes: GlpiPlugin\<Plugin>\<Class>
      if (/^GlpiPlugin\\[A-Za-z0-9_]+(\\[A-Za-z0-9_]+)+$/i.test(normalized)) {
        return true;
      }

      // Check legacy plugin classes: Plugin<Plugin><Class>
      if (/^Plugin[A-Za-z0-9_]+$/.test(itemType)) {
        return true;
      }
    }

    throw new InvalidItemTypeError(`Invalid item type '${itemType}'`);
  }

  /**
   * Extract min, max and total from Content-Range header
   *
   * @param {object} headers key/value object of HTTP headers
   * @returns {object}
   * @private
   */
  _parseContentRange(headers) {
    const pattern = /(\d+)-(\d+)\/(\d+)/;
    if (!headers || !headers['content-range'] || !pattern.test(headers['content-range'])) {
      return {};
    }
    const [ , min, max, total ] = pattern.exec(headers['content-range']);
    return {
      min   : parseInt(min, 10),
      max   : parseInt(max, 10),
      total : parseInt(total, 10),
    };
  }

  /**
   * Add one or more custom itemTypes to the valid itemTypes list
   *
   * @param {string|array} customItemTypes String or array of string of itemType to add to the valid itemTypes list
   */
  addCustomItemTypes(customItemTypes) {
    if (!_.isArray(customItemTypes)) {
      customItemTypes = [customItemTypes];
    }
    if (!this._itemTypes) {
      this._itemTypes = [...itemTypes];
    }
    customItemTypes.forEach((customItemType) => {
      this._itemTypes.push(customItemType);
    });
  }

  /**
   * Request a session token to use other api endpoints.
   * @returns {Promise}
   */
  initSession() {
    log('Calling initSession()');

    const headers = {
      'App-Token' : this._settings.app_token,
    };

    if (this._settings.user_token) {
      headers.Authorization = `user_token ${this._settings.user_token}`;
    } else {
      headers.Authorization = `Basic ${this._settings.auth}`;
    }

    return this._request(HTTP_GET, '/initSession', { headers })
    .then((response) => {
      this._session = response.data.session_token;
      return response;
    });
  }

  /**
   * Destroy a session identified by a session token.
   * @returns {Promise}
   */
  killSession() {
    log('Calling killSession()');

    if (!this._session) {
      throw new SessionNotFoundError('No session found');
    }

    return this._request(HTTP_GET, '/killSession')
    .then((response) => {
      this._session = '';
      return response;
    });
  }

  /**
   * Sends a notification to the user to reset his password.
   * Reset the password if `password_forget_token` and `password` are provided
   *
   * @param {string} email email address of the user to recover. Mandatory.
   * @param {string} password_forget_token reset token. Mandatory to reset password
   * @param {string} password the new password for the user. Mandatory to reset password
   * @returns {Promise}
   */
  lostPassword(email, password_forget_token, password) {
    log('Calling lostPassword()');

    const body = {
      email,
      password_forget_token,
      password,
    };

    return this._request(HTTP_PUT, '/lostPassword', { body });
  }

  /**
   * Return all the profiles associated to logged user.
   * @returns {Promise}
   */
  getMyProfiles() {
    return this._request(HTTP_GET, '/getMyProfiles')
    .then((response) => ({ code : response.code, data : response.data.myprofiles }));
  }

  /**
   * Return the current active profile.
   * @returns {Promise}
   */
  getActiveProfile() {
    return this._request(HTTP_GET, '/getActiveProfile')
    .then((response) => ({ code : response.code, data : response.data.active_profile }));
  }

  /**
   * Change active profile to the profiles_id one.
   * See ${getMyProfiles} endpoint for possible profiles.
   *
   * @param {integer} profiles_id  ID of the new active profile.
   * @returns {Promise}
   */
  changeActiveProfile(profiles_id) {
    const body = { profiles_id };
    return this._request(HTTP_POST, '/changeActiveProfile', { body });
  }

  /**
   * Return all the possible entities of the current logged user (and for current active profile).
   *
   * @returns {Promise}
   */
  getMyEntities() {
    return this._request(HTTP_GET, '/getMyEntities')
    .then((response) => ({ code : response.code, data : response.data.myentities }));
  }


  /**
   * Return active entities of current logged user.
   *
   * @returns {Promise}
   */
  getActiveEntities() {
    return this._request(HTTP_GET, '/getActiveEntities')
    .then((response) => ({ code : response.code, data : response.data.active_entity }));
  }

  /**
   * Change active profile to the profiles_id one.
   * See getMyProfiles endpoint for possible profiles.
   *
   * @param {integer} profiles_id  ID of the new active profile.
   * @returns {Promise}
   */
  changeActiveEntities(entities_id, is_recursive = 'false') {
    const body = { entities_id, is_recursive };
    return this._request(HTTP_POST, '/changeActiveEntities', { body });
  }

  /**
   * Return the current php $_SESSION.
   *
   * @returns {Promise}
   */
  getFullSession() {
    return this._request(HTTP_GET, '/getFullSession')
    .then((response) => ({ code : response.code, data : response.data.session }));
  }

  /**
   * Return the instance fields of itemtype identified by id.
   *
   * @param {string} itemType itemtype requested
   * @param {string} id unique identifier of the itemtype. Mandatory.
   * @param {object} [opts]
   * @param {boolean} [opts.expand_dropdowns=false] show dropdown name instead of id.
   * @param {boolean} [opts.get_hateoas=true] Show relations of the item in a links attribute.
   * @param {boolean} [opts.get_sha1=false] Get a sha1 signature instead of the full answer.
   * @param {boolean} [opts.with_devices=false] Only for [Computer, NetworkEquipment, Peripheral, Phone, Printer], retrieve the associated components.
   * @param {boolean} [opts.with_disks=false] Only for Computer, retrieve the associated file-systems.
   * @param {boolean} [opts.with_softwares=false] Only for Computer, retrieve the associated software's installations.
   * @param {boolean} [opts.with_connections=false] Only for Computer, retrieve the associated direct connections (like peripherals and printers) .Optional.
   * @param {boolean} [opts.with_networkports=false] Retrieve all network's connections and advanced network's informations.
   * @param {boolean} [opts.with_infocoms=false] Retrieve financial and administrative informations.
   * @param {boolean} [opts.with_contracts=false] Retrieve associated contracts.
   * @param {boolean} [opts.with_documents=false] Retrieve associated external documents.
   * @param {boolean} [opts.with_tickets=false] Retrieve associated itil tickets.
   * @param {boolean} [opts.with_problems=false] Retrieve associated itil problems.
   * @param {boolean} [opts.with_changes=false] Retrieve associated itil changes.
   * @param {boolean} [opts.with_notes=false] Retrieve Notes.
   * @param {boolean} [opts.with_logs=false] Retrieve historical.
   * @returns {Promise}
   */
  getItem(itemType, id, opts = {}) {
    this._validateItemType(itemType);
    const encodedId = this._validateAndEncodeId(id);

    const options = {
      expand_dropdowns  : false,
      get_hateoas       : true,
      get_sha1          : false,
      with_devices      : false,
      with_disks        : false,
      with_softwares    : false,
      with_connections  : false,
      with_networkports : false,
      with_infocoms     : false,
      with_contracts    : false,
      with_documents    : false,
      with_tickets      : false,
      with_problems     : false,
      with_changes      : false,
      with_notes        : false,
      with_logs         : false,
    };

    const query = Object.assign({}, options, opts);
    const endpoint = `/${this._encodeItemType(itemType)}/${encodedId}`;

    return this._request(HTTP_GET, endpoint, { query });
  }

  /**
   * Return a collection of rows of the itemtype.
   *
   * @param {string} itemType itemtype requested
   * @param {object} [opts]
   * @param {boolean} [opts.expand_dropdowns=false] show dropdown name instead of id.
   * @param {boolean} [opts.get_hateoas=true] Show relation of item in a links attribute.
   * @param {boolean} [opts.only_id=false] keep only id keys in returned data.
   * @param {string} [opts.range=0-50] a string with a couple of number for start and end of pagination separated by a '-'. Ex: 150-200.
   * @param {string} [opts.sort=id] id of the searchoption to sort by.
   * @param {string} [opts.order=DESC] ASC - Ascending sort / DESC Descending sort.
   * @param {string} [opts.searchText] array of filters to pass on the query (with key = field and value the text to search)
   * @param {boolean} [opts.is_deleted=false] Return deleted element.
   * @returns {Promise}
   */
  getItems(itemType, opts = {}) {
    this._validateItemType(itemType);

    const options = {
      expand_dropdowns  : false,
      get_hateoas       : true,
      only_id           : false,
      range             : '0-50',
      sort              : 'id',
      order             : 'DESC',
      searchText        : '',
      is_deleted        : false,
    };

    const query = Object.assign({}, options, opts);
    const endpoint = `/${this._encodeItemType(itemType)}`;

    return this._request(HTTP_GET, endpoint, { query });
  }

  /**
   *
   * @param {string|object} itemType parent itemtype provided. If Object, id must not be provided
   * @param {string} id unique identifier of the itemtype. Mandatory if itemType is a string.
   * @param {string} subItemType subItemType requested
   * @param {object} [opts]
   * @param {boolean} [opts.expand_dropdowns=false] show dropdown name instead of id. Optional.
   * @param {boolean} [opts.get_hateoas=true] Show relation of item in a links attribute. Optional.
   * @param {boolean} [opts.only_id=false] keep only id keys in returned data. Optional.
   * @param {string} [opts.range=0-50] a string with a couple of number for start and end of pagination separated by a '-'. Ex: 150-200. Optional.
   * @param {string} [opts.sort=id] id of the searchoption to sort by. Optional.
   * @param {string} [opts.order=DESC] ASC - Ascending sort / DESC Descending sort. Optional.
   * @returns {Promise}
   */
  getSubItems(itemType, id, subItemType, opts = {}) {

    const options = {
      expand_dropdowns  : false,
      get_hateoas       : true,
      only_id           : false,
      range             : '0-50',
      sort              : 'id',
      order             : 'DESC',
    };

    let endpoint;

    if (_.isPlainObject(itemType)) {
      const item = itemType;
      opts = subItemType;
      subItemType = id;

      if (!item.links || !_.isArray(item.links)) {
        throw new MissingHATEOASError('Missing HATEOAS on provided object');
      }
      this._validateItemType(subItemType);

      const link = item.links.find((e) => this._encodeItemType(e.rel) === this._encodeItemType(subItemType));

      if (!link) {
        throw new MissingHATEOASError(`Missing link for '${subItemType}' on provided object`);
      }

      const url = new URL(link.href);

      if (url.origin !== this._settings.apiurl.origin) {
        throw new ServerError('HATEOAS link targets an untrusted external origin');
      }

      if (!url.pathname.startsWith(this._settings.apiurl.pathname)) {
        throw new ServerError('HATEOAS link targets an invalid endpoint path');
      }

      endpoint = url.pathname.slice(this._settings.apiurl.pathname.length) + (url.search || '');
      if (!endpoint.startsWith('/')) {
        endpoint = `/${endpoint}`;
      }
      if (endpoint[endpoint.length - 1] === '/') {
        endpoint = endpoint.slice(0, -1);
      }

    }
    else {
      this._validateItemType(itemType);
      this._validateItemType(subItemType);
      const encodedId = this._validateAndEncodeId(id);

      endpoint = `/${this._encodeItemType(itemType)}/${encodedId}/${this._encodeItemType(subItemType)}`;
    }

    const query = Object.assign({}, options, opts);

    return this._request(HTTP_GET, endpoint, { query });
  }

  /**
   * Virtually call Get an item for each line in input. So, you can have a ticket and a user in the same query.
   *
   * @param {object} [opts]
   * @param {object[]} opts.items items to retrieve. Mandatory. Each line of this array should contains two keys: `itemtype`and `items_id`
   * @param {string} opts.items[].itemtype itemtype requested
   * @param {string} opts.items[].items_id unique identifier of the itemtype
   * @param {boolean} [opts.expand_dropdowns=false] show dropdown name instead of id. Optional.
   * @param {boolean} [opts.get_hateoas=true] Show relations of the item in a links attribute. Optional.
   * @param {boolean} [opts.get_sha1=false] Get a sha1 signature instead of the full answer. Optional.
   * @param {boolean} [opts.with_devices=false] Only for [Computer, NetworkEquipment, Peripheral, Phone, Printer], retrieve the associated components. Optional.
   * @param {boolean} [opts.with_disks=false] Only for Computer, retrieve the associated file-systems. Optional.
   * @param {boolean} [opts.with_softwares=false] Only for Computer, retrieve the associated software's installations. Optional.
   * @param {boolean} [opts.with_connections=false] Only for Computer, retrieve the associated direct connections (like peripherals and printers) .Optional.
   * @param {boolean} [opts.with_networkports=false] Retrieve all network's connections and advanced network's informations. Optional.
   * @param {boolean} [opts.with_infocoms=false] Retrieve financial and administrative informations. Optional.
   * @param {boolean} [opts.with_contracts=false] Retrieve associated contracts. Optional.
   * @param {boolean} [opts.with_documents=false] Retrieve associated external documents. Optional.
   * @param {boolean} [opts.with_tickets=false] Retrieve associated itil tickets. Optional.
   * @param {boolean} [opts.with_problems=false] Retrieve associated itil problems. Optional.
   * @param {boolean} [opts.with_changes=false] Retrieve associated itil changes. Optional.
   * @param {boolean} [opts.with_notes=false] Retrieve Notes. Optional.
   * @param {boolean} [opts.with_logs=false] Retrieve historical. Optional.
   * @returns {Promise}
   */
  getMultipleItems(opts = {}) {
    const options = {
      items             : [],
      expand_dropdowns  : false,
      get_hateoas       : true,
      get_sha1          : false,
      with_devices      : false,
      with_disks        : false,
      with_softwares    : false,
      with_connections  : false,
      with_networkports : false,
      with_infocoms     : false,
      with_contracts    : false,
      with_documents    : false,
      with_tickets      : false,
      with_problems     : false,
      with_changes      : false,
      with_notes        : false,
      with_logs         : false,
    };

    const query = Object.assign({}, options, opts);

    if (opts.items && _.isArray(opts.items)) {
      query.items = opts.items.map((item) => {
        if (!item || !item.itemtype) {
          throw new InvalidParameterError('Invalid item in items array');
        }
        this._validateItemType(item.itemtype);
        return {
          ...item,
          itemtype: this._encodeItemType(item.itemtype),
        };
      });
    } else {
      throw new InvalidParameterError('Invalid parameter');
    }
    return this._request(HTTP_GET, '/getMultipleItems', { query });
  }

  /**
   * List the searchoptions of provided itemtype. To use with Search items.
   *
   * @param {string} itemType itemType requested
   * @param {boolean} [raw=false] return searchoption uncleaned if true (as provided by core)
   * @returns {Promise}
   */
  listSearchOptions(itemType, raw = false) {
    this._validateItemType(itemType);

    const query = (raw) ? { raw : true } : undefined;
    const endpoint = `/listSearchOptions/${this._encodeItemType(itemType)}`;

    return this._request(HTTP_GET, endpoint, { query });
  }

  /**
   * Expose the GLPI searchEngine and combine criteria to retrieve a list of elements of specified itemtype.
   *
   * Note: you can use 'AllAssets' itemtype to retrieve a combination of all asset's types.
   *
   * @param {string} itemType itemType requested
   * @param {object} [opts]
   * @param {object[]} opts.criteria array of criterion objects to filter search. Optional.
   * Each criterion object must provide :
   * + _link_: (optional for 1st element) logical operator in [AND, OR, AND NOT, AND NOT].
   * + _field_: id of the searchoption.
   * + _searchtype_: type of search in [contains, equals, notequals, lessthan, morethan, under, notunder].
   * + _value_: the value to search.
   * @param {string} opts.criteria[].link (optional for 1st element) logical operator in [AND, OR, AND NOT, AND NOT].
   * @param {string} opts.criteria[].field id of the searchoption.
   * @param {string} opts.criteria[].searchtype type of search in [contains, equals, notequals, lessthan, morethan, under, notunder].
   * @param {string} opts.criteria[].value the value to search.
   * @param {object[]} opts.metacriteria array of meta-criterion objects to filter search. Optional.
   * A meta search is a link with another itemtype (ex: Computer with softwares). Each meta-criterion object must provide:
   * + _link_: logical operator in [AND, OR, AND NOT, AND NOT]. Mandatory.
   * + _itemtype_ : second itemtype to link.
   * + _field_: id of the searchoption.
   * + _searchtype_: type of search in [contains, equals, notequals, lessthan, morethan, under, notunder].
   * + _value_: the value to search.
   * @param {string} opts.metacriteria[].link logical operator in [AND, OR, AND NOT, AND NOT]. Mandatory.
   * @param {string} opts.metacriteria[].itemtype second itemtype to link.
   * @param {string} opts.metacriteria[].field id of the searchoption.
   * @param {string} opts.metacriteria[].searchtype type of search in [contains, equals, notequals, lessthan, morethan, under, notunder].
   * @param {string} opts.metacriteria[].value the value to search.
   * @param {string} [opts.sort=id] id of the searchoption to sort by. Optional.
   * @param {object} [opts.order=DESC] ASC - Ascending sort / DESC Descending sort. Optional.
   * @param {object} [opts.range=0-50] a string with a couple of number for start and end of pagination separated by a '-'. Ex: 150-200. Optional.
   * @param {array} opts.forcedisplay array of columns to display (default empty = use display preferences and searched criteria).
   * Some columns will be always presents (1: id, 2: name, 80: Entity). Optional.
   * @param {object} [opts.rawdata=false] a boolean for displaying raws data of the Search engine of glpi (like SQL request, full searchoptions, etc)
   * @param {object} [opts.withindexes=false] a boolean to retrieve rows indexed by items id. By default this option is set to false,
   * because order of json objects (which are identified by index) cannot be garrantued
   * (from http://json.org/ : An object is an unordered set of name/value pairs). So, we provide arrays to guarantying sorted rows.
   * @param {object} [opts.uid_cols=false] a boolean to identify cols by the 'uniqid' of the searchoptions instead of a numeric value (see List searchOptions and 'uid' field)
   * @param {object} [opts.giveItems=false] a boolean to retrieve the data with the html parsed from core, new data are provided in data_html key.
   * @returns {Promise}
   */
  search(itemType, opts = {}) {
    this._validateItemType(itemType);

    const options = {
      criteria     : [],
      metacriteria : [],
      sort         : 'id',
      order        : 'DESC',
      forcedisplay : [],
      rawdata      : false,
      withindexes  : false,
      uid_cols     : false,
      giveItems    : false,
    };

    const query = Object.assign({}, options, opts);
    const endpoint = `/search/${this._encodeItemType(itemType)}`;

    return this._request(HTTP_GET, endpoint, { query });
  }

  /**
   * Add an object (or multiple objects) into GLPI.
   *
   * @param {string} itemType itemType requested
   * @param {object|object[]} input an object with fields of itemtype to be inserted.
   * You can add several items in one action by passing an array of objects. Mandatory.
   * @returns {Promise}
   */
  addItems(itemType, input = {}) {
    this._validateItemType(itemType);

    if (!input || _.isEmpty(input)) {
      throw new InvalidParameterError('Invalid parameter');
    }

    const body = { input };

    return this._request(HTTP_POST, `/${this._encodeItemType(itemType)}`, { body });
  }

  /**
   * Update an object (or multiple objects) existing in GLPI.
   *
   * @param {string} itemType itemType requested
   * @param {string} [id] the unique identifier of the itemtype passed in URL.
   * You could skip this parameter by passing it in the input payload.
   * @param {object|object[]} input an object with fields of itemtype to be inserted.
   * You can add several items in one action by passing an array of objects. Mandatory.
   * @returns {Promise}
   */
  updateItems(itemType, id, input = {}) {
    this._validateItemType(itemType);
    if ((!input || _.isEmpty(input)) && (_.isPlainObject(id) || _.isArray(id))) {
      input = id;
      id = undefined;
    }

    if (!input || _.isEmpty(input) || (!id && !input.id && !input.length) || (id && input.length)) {
      throw new InvalidParameterError('Invalid parameter');
    }

    if (input.length) {
      const invalidArray = input.some(item => !item.id);
      if (invalidArray) {
        throw new InvalidParameterError('Invalid parameter');
      }
    }

    let endpoint = `/${this._encodeItemType(itemType)}`;
    if (id) {
      endpoint += `/${this._validateAndEncodeId(id)}`;
    }

    const body = { input };

    return this._request(HTTP_PUT, endpoint, { body });

  }

  /**
   * Delete an object existing in GLPI.
   *
   * @param {string} itemType itemType requested
   * @param {string} [id] the unique identifier of the itemtype passed in URL.
   * You could skip this parameter by passing it in the input payload.
   * @param {object|object[]} input Array of id who need to be deleted.
   * @param {object} [opts]
   * @param {object} [opts.force_purge=false] boolean, if the itemtype have a dustbin, you can force purge (delete finally). Optional.
   * @param {object} [opts.history=true] boolean, set to false to disable saving of deletion in global history. Optional.
   * @returns {Promise}
   */
  deleteItems(itemType, id, input = {}, opts = {}) {
    this._validateItemType(itemType);
    if (_.isPlainObject(id) || _.isArray(id)) {
      opts = input;
      input = id;
      id = undefined;
    }

    if ((!id && !input.id && !input.length) || (id && input.length)) {
      throw new InvalidParameterError('Invalid parameter');
    }

    if (input.length) {
      const invalidArray = input.some(item => !item.id);
      if (invalidArray) {
        throw new InvalidParameterError('Invalid parameter');
      }
    }

    const options = {
      force_purge : false,
      history     : true,
    };

    const query = Object.assign({}, options, opts);
    const body = { input };

    let endpoint = `/${this._encodeItemType(itemType)}`;
    if (id) endpoint += `/${this._validateAndEncodeId(id)}`;

    return this._request(HTTP_DELETE, endpoint, { body, query });
  }

  /**
   * Upload a document to GLPI
   *
   * @param {string} filePath Absolute path to the file to upload
   * @param {object} [input={}] an object with fields of itemtype to be inserted.
   * @param {string} [description=''] Description to add to document
   * @returns {Promise}
   */
  upload(fileinfo, input = {}, description = '') {
    let filePath;
    let fileName;
    let fileType = null;

    // for compatibility with previous version
    if (typeof fileinfo === 'string') {
      filePath = fileinfo;
      const file = path.parse(filePath);
      fileName = file.name + file.ext;
    } else {
      ({ filePath, fileName, fileType } = fileinfo);
    }
    
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (err) {
      throw new FileNotReadableError();
    }

    const readStream  = fs.createReadStream(filePath);
    const uploadManifest = JSON.stringify({
      input : {
        name : description || fileName,
        _filename: [fileName],
        ...input,
      },
    });

    log('> uploadManifest :', uploadManifest);

    const formData = {
      uploadManifest,
      'filename[0]' : {
        value : readStream,
        options : {
          filename : fileName,
          contentType : fileType,
        }
      },
    };

    log('> formData :', formData);

    return this._request(HTTP_POST, '/Document', { formData });
  }

  /**
   * Download a document from GLPI
   *
   * @param {string|number} documentId unique identifier of the itemtype passed in the URL.
   * @returns {Promise}
   */
  download(documentId) {
    if (!documentId || isNaN(documentId)) {
      throw new InvalidParameterError('Invalid parameter');
    }

    const headers = {
      Accept : 'application/octet-stream',
    };

    return this._request(HTTP_GET, `/Document/${documentId}`, { headers });
  }
}

module.exports = Glpi;
