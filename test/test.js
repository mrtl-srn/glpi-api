process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},glpiapi.test` : 'glpiapi.test';
process.env.no_proxy = process.env.NO_PROXY;
const chai = require('chai');
const nock = require('nock');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const Glpi = require('../glpi');

const requestTypePhone = require('./requesttype_phone.json');
const myProfiles = require('./myprofiles.json');
const activeProfile = require('./activeprofile.json');
const myEntities = require('./myentities.json');
const activeEntitiesAll = require('./activeentities_all.json');
const fullSession = require('./fullsession.json');
const itemTicketDefault = require('./ticket_default.json');
const itemTicketExpandedDropdowns = require('./ticket_expanded_dropdowns.json');
const itemTicketWithoutHateoas = require('./ticket_without_hateoas.json');
const itemTicketLogDefault = require('./ticket_log_default.json');
const itemTicketTasksDefault = require('./ticket_tasks_default.json');
const itemTickets = require('./tickets.json');
const itemComputerDefault = require('./computer_default.json');
const itemComputerWithDevices = require('./computer_with_devices.json');
const itemMultipleTicketUser = require('./multiple_ticket_user.json');
const searchOptionsTicket = require('./searchoptions_ticket.json');
const searchOptionsTicketRaw = require('./searchoptions_ticket_raw.json');
const searchTicket = require('./search_ticket.json');
const searchTicketNoOpts = require('./search_ticket_no_opts.json');
const upload = require('./upload.json');
const upload_custom_filename = require('./upload_custom_filename.json');
const upload_without_comment = require('./upload_without_comment.json');

const ServerError = require('../errors/ServerError');
const SessionNotFoundError = require('../errors/SessionNotFoundError');
const InvalidItemTypeError = require('../errors/InvalidItemTypeError');
const InvalidParameterError = require('../errors/InvalidParameterError');
const MissingAuthorizationError = require('../errors/MissingAuthorizationError');
const MissingAppTokenError = require('../errors/MissingAppTokenError');
const MissingAPIURLError = require('../errors/MissingAPIURLError');
const MissingHATEOASError = require('../errors/MissingHATEOASError');
const MissingItemTypeError = require('../errors/MissingItemTypeError');
const InvalidAPIURLError = require('../errors/InvalidAPIURLError');
const InvalidHTTPMethodError = require('../errors/InvalidHTTPMethodError');
const FileNotReadableError = require('../errors/FileNotReadableError');

const genToken = () => Math.random().toString(36).substr(2);
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

const expect = chai.expect;

const baseURL = 'http://glpiapi.test';
const apiurl = `${baseURL}/apirest.php`;
const app_token = 'azertyuiop';
const user_token = 'qsdfghjklm';

const config = {
  userToken : {
    app_token,
    apiurl,
    user_token,
  },
  basicAuth : {
    app_token,
    apiurl,
    auth      : {
      username : 'glpi',
      password : 'glpi',
    },
  },
};


describe('ServerError', () => {
  it('should return a ServerError with code 500', () => {
    const err = new ServerError();
    expect(err).to.be.an.instanceOf(ServerError);
    expect(err).to.have.property('code', 500);
  });
});

describe('_validateItemType()', () => {
  it('should throw InvalidItemTypeError', () => {
    const customItemType = 'MyCustomItemType';
    const glpi = new Glpi(config.userToken);
    try {
      const result = glpi._validateItemType(customItemType);
      expect(result).to.be.undefined;
    } catch(err) {
      expect(err).to.be.instanceOf(InvalidItemTypeError);
    }
  });

  it('should not throw InvalidItemTypeError (1 custom itemtype)', () => {
    const customItemType = 'MyCustomItemType';
    const glpi = new Glpi(config.userToken);
    glpi.addCustomItemTypes(customItemType);
    const result = glpi._validateItemType(customItemType);
    expect(result).to.be.a('boolean', true);
  });

  it('should not throw InvalidItemTypeError (3 custom itemtypes)', () => {
    const customItemTypes = ['MyCustomItemType1', 'MyCustomItemType2', 'MyCustomItemType3'];
    const glpi = new Glpi(config.userToken);
    glpi.addCustomItemTypes(customItemTypes);
    customItemTypes.forEach((customItemType) => {
      const result = glpi._validateItemType(customItemType);
      expect(result).to.be.a('boolean', true);
    });
  });

  it('should accept GLPI 11 namespaced plugin classes', () => {
    const glpi = new Glpi(config.userToken);
    expect(glpi._validateItemType('GlpiPlugin\\Shipping\\Client')).to.be.a('boolean', true);
    expect(glpi._validateItemType('GlpiPlugin\\Changefields\\Changefield')).to.be.a('boolean', true);
  });

  it('should accept GLPI 11 URL-encoded plugin classes', () => {
    const glpi = new Glpi(config.userToken);
    expect(glpi._validateItemType('GlpiPlugin%5cShipping%5cClient')).to.be.a('boolean', true);
    expect(glpi._validateItemType('GlpiPlugin%5CShipping%5CClient')).to.be.a('boolean', true);
  });

  it('should accept legacy plugin classes', () => {
    const glpi = new Glpi(config.userToken);
    expect(glpi._validateItemType('PluginShippingClient')).to.be.a('boolean', true);
    expect(glpi._validateItemType('PluginChangefieldsChangefield')).to.be.a('boolean', true);
  });

  it('should throw InvalidItemTypeError for invalid plugin classes and non-string types', () => {
    const glpi = new Glpi(config.userToken);
    expect(() => glpi._validateItemType('GlpiPlugin')).to.throw(InvalidItemTypeError);
    expect(() => glpi._validateItemType('GlpiPlugin\\')).to.throw(InvalidItemTypeError);
    expect(() => glpi._validateItemType('Plugin@Invalid')).to.throw(InvalidItemTypeError);
    expect(() => glpi._validateItemType(12345)).to.throw(InvalidItemTypeError);
  });

  it('should properly encode itemType backslashes with _encodeItemType()', () => {
    const glpi = new Glpi(config.userToken);
    expect(glpi._encodeItemType('GlpiPlugin\\Shipping\\Client')).to.equal('GlpiPlugin%5CShipping%5CClient');
    expect(glpi._encodeItemType('GlpiPlugin%5cShipping%5cClient')).to.equal('GlpiPlugin%5CShipping%5CClient');
    expect(glpi._encodeItemType('GlpiPlugin%5CShipping%5CClient')).to.equal('GlpiPlugin%5CShipping%5CClient');
    expect(glpi._encodeItemType('Ticket')).to.equal('Ticket');
    expect(glpi._encodeItemType('PluginShippingClient')).to.equal('PluginShippingClient');
    expect(glpi._encodeItemType(null)).to.be.null;
    expect(glpi._encodeItemType(undefined)).to.be.undefined;
    expect(glpi._encodeItemType(123)).to.equal(123);
  });
});


describe('contructor()', () => {
  it('should throw InvalidAPIURLError', () => {
    const fakeConfig = deepClone(config.userToken);
    fakeConfig.apiurl = 'not_a_valid_url';
    try {
      const glpi = new Glpi(fakeConfig);
      expect(glpi).to.be.undefined;
    } catch(err) {
      expect(err).to.be.instanceOf(InvalidAPIURLError);
    }
  });

  describe('With user_token Authorisation method', () => {
    it('should create a Glpi object', () => {
      const glpi = new Glpi(config.userToken);
      expect(glpi).to.be.instanceOf(Glpi);
      expect(glpi).to.have.deep.own.property('_settings', {
        user_token : config.userToken.user_token,
        auth       : undefined,
        app_token  : config.userToken.app_token,
        apiurl     : new URL(config.userToken.apiurl),
        port       : undefined,
      });
    });

    it('should throw MissingAuthorizationError (no config object)', () => {
      try {
        const glpi = new Glpi();
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAuthorizationError);
      }
    });

    it('should throw MissingAppTokenError (no App-Token)', () => {
      const fakeConfig = deepClone(config.userToken);
      delete fakeConfig.app_token;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAppTokenError);
      }
    });

    it('should throw MissingAuthorizationError (no user_token)', () => {
      const fakeConfig = deepClone(config.userToken);
      delete fakeConfig.user_token;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAuthorizationError);
      }
    });
  });

  describe('With Basic Authorisation method', () => {
    it('should create a Glpi object ', () => {
      const glpi = new Glpi(config.basicAuth);
      const base64 = Buffer.from(`${config.basicAuth.auth.username}:${config.basicAuth.auth.password}`).toString('base64');
      expect(glpi).to.be.instanceOf(Glpi);
      expect(glpi).to.have.deep.own.property('_settings', {
        auth       : base64,
        app_token  : config.basicAuth.app_token,
        apiurl     : new URL(config.basicAuth.apiurl),
        user_token : undefined,
        port       : undefined,
      });
    });

    it('should throw MissingAppTokenError (no App-Token)', () => {
      const fakeConfig = deepClone(config.basicAuth);
      delete fakeConfig.app_token;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAppTokenError);
      }
    });

    it('should throw MissingAuthorizationError (no auth)', () => {
      const fakeConfig = deepClone(config.basicAuth);
      delete fakeConfig.auth;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAuthorizationError);
      }
    });

    it('should throw MissingAuthorizationError (no username)', () => {
      const fakeConfig = deepClone(config.basicAuth);
      delete fakeConfig.auth.username;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAuthorizationError);
      }
    });

    it('should throw MissingAuthorizationError (no password)', () => {
      const fakeConfig = deepClone(config.basicAuth);
      delete fakeConfig.auth.password;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAuthorizationError);
      }
    });

    it('should throw MissingAPIURLError', () => {
      const fakeConfig = deepClone(config.basicAuth);
      delete fakeConfig.apiurl;
      try {
        const glpi = new Glpi(fakeConfig);
        expect(glpi).to.be.undefined;
      } catch(err) {
        expect(err).to.be.instanceOf(MissingAPIURLError);
      }
    });
  });
});

describe('initSession()', () => {
  describe('Token Authorisation method', () => {

    afterEach(() => {
      nock.cleanAll();
    });

    it('should connect successfully', async () => {
      const expectedCode = 200;
      const expectedBody = { session_token : genToken() };
      nock(config.userToken.apiurl)
      .matchHeader('app-token', config.userToken.app_token)
      .matchHeader('authorization', `user_token ${config.userToken.user_token}`)
      .get('/initSession')
      .reply(expectedCode, expectedBody);

      const glpi = new Glpi(config.userToken);
      const result = await glpi.initSession();
      expect(result).to.have.property('code', expectedCode);
      expect(result).to.have.nested.property('data.session_token', expectedBody.session_token);
    });

    it('wrong app_token should not connect successfully', async () => {

      const fakeConfig = deepClone(config.userToken);
      fakeConfig.app_token = 'boggus';

      const expectedCode = 400;
      const expectedBody = [
        'ERROR_APP_TOKEN_PARAMETERS_MISSING',
        `missing parameter app_token; view documentation in your browser at ${fakeConfig.apiurl}/#ERROR_APP_TOKEN_PARAMETERS_MISSING`
      ];

      nock(fakeConfig.apiurl)
      .matchHeader('app-token', fakeConfig.app_token)
      .matchHeader('authorization', `user_token ${fakeConfig.user_token}`)
      .get('/initSession')
      .reply(expectedCode, expectedBody, { statusMessage : 'Bad Request'});

      const glpi = new Glpi(fakeConfig);
      try {
        const result = await glpi.initSession();
        expect(result).to.be.undefined;
      } catch (err) {
        expect(err).to.be.instanceOf(ServerError);
        expect(err).to.have.property('code', expectedCode);
        expect(err).to.have.property('message', expectedBody[0]);
        expect(err).to.have.property('comment', expectedBody[1]);
      }
    });
  });

  describe('Basic Authorisation method', () => {
    afterEach(() => {
      nock.cleanAll();
    });
    it('should connect successfully', async () => {
      const base64 = Buffer.from(`${config.basicAuth.auth.username}:${config.basicAuth.auth.password}`).toString('base64');
      const expectedCode = 200;
      const expectedBody = {
        session_token : genToken(),
      };
      nock(config.basicAuth.apiurl)
      .matchHeader('app-token', config.basicAuth.app_token)
      .matchHeader('authorization', `Basic ${base64}`)
      .get('/initSession')
      .reply(expectedCode, expectedBody);

      const glpi = new Glpi(config.basicAuth);
      const result = await glpi.initSession();
      expect(result).to.have.property('code', expectedCode);
      expect(result).to.have.nested.property('data.session_token', expectedBody.session_token);
    });

    it('wrong password should not connect successfully', async () => {
      const fakeConfig = deepClone(config.basicAuth);
      fakeConfig.auth.password = 'boggus';

      const expectedCode = 401;
      const expectedBody = [
        'ERROR_GLPI_LOGIN_USER_TOKEN',
        'le paramètre user_token semble incorrect',
      ];

      const base64 = Buffer.from(`${fakeConfig.auth.username}:${fakeConfig.auth.password}`).toString('base64');
      nock(fakeConfig.apiurl)
      .matchHeader('app-token', fakeConfig.app_token)
      .matchHeader('authorization', `Basic ${base64}`)
      .get('/initSession')
      .reply(expectedCode, expectedBody, { statusMessage : 'Unauthorized' });

      const glpi = new Glpi(fakeConfig);
      try {
        const result = await glpi.initSession();
        expect(result).to.be.undefined;
      } catch (err) {
        expect(err).to.be.instanceOf(ServerError);
        expect(err).to.have.property('code', expectedCode);
        expect(err).to.have.property('message', expectedBody[0]);
        expect(err).to.have.property('comment', expectedBody[1]);
      }
    });
  });
});

describe('lostPassword()', () => {
  it('should request a new password successfully', async () => {
    const expectedCode = 200;
    const expectedBody = [
      'Un courriel a été envoyé à votre adresse email. Le courriel contient les informations pour réinitialiser votre mot de passe.',
    ];
    nock(config.userToken.apiurl)
    .put('/lostPassword', { email : 'martial.seron@gmail.com' })
    .reply(expectedCode, expectedBody);

    const glpi = new Glpi(config.userToken);
    const result = await glpi.lostPassword('martial.seron@gmail.com');
    expect(result).to.have.property('code', expectedCode);
    expect(result).to.have.nested.property('data[0]', expectedBody[0]);
  });

  it('should return that the email does not exist', async () => {
    const expectedCode = 400;
    const expectedBody = [
      'ERROR',
      `L'adresse demandée est inconnue.; Afficher la documentation dans votre navigateur à ${config.userToken.apiurl}/#ERROR`,
    ];
    nock(config.userToken.apiurl)
    .put('/lostPassword', { email : 'unknown@gmail.com' })
    .reply(expectedCode, expectedBody, { statusMessage : 'Bad Request' });

    const glpi = new Glpi(config.userToken);
    try {
      const result = await glpi.lostPassword('unknown@gmail.com');
      expect(result).to.be.undefined;
    }
    catch(err) {
      expect(err).to.be.instanceOf(ServerError);
      expect(err).to.have.property('code', expectedCode);
      expect(err).to.have.property('message', expectedBody[0]);
      expect(err).to.have.property('comment', expectedBody[1]);
    }
  });
});

describe('Authenticated methods', () => {
  const glpi = new Glpi(config.userToken);
  let sessionToken = genToken();

  beforeEach(() => {
    nock(config.userToken.apiurl)
    .matchHeader('app-token', config.userToken.app_token)
    .matchHeader('authorization', `user_token ${config.userToken.user_token}`)
    .get('/initSession')
    .reply(200, { session_token : sessionToken });

    return glpi.initSession()
    .then(() => nock.cleanAll());
  });

  afterEach(() => {
    nock.cleanAll();
    sessionToken = genToken();
  });

  describe('POST methods', () => {
    describe('changeActiveProfile()', () => {
      it('should change my active profile', async () => {
        const requestedProfile = 9;
        const expectedCode = 200;
        const expectedPostBody = { profiles_id : requestedProfile };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveProfile', expectedPostBody)
        .reply(expectedCode);

        const result = await glpi.changeActiveProfile(requestedProfile);
        expect(result).to.have.property('code', expectedCode);
      });

      it('should throw a ServerError 404 if profile is not valid', async () => {
        const requestedProfile = 999;
        const expectedCode = 404;
        const expectedPostBody = { profiles_id : requestedProfile };
        const expectedBody = [
          'ERROR_ITEM_NOT_FOUND',
          'Élément introuvable',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveProfile', expectedPostBody)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.changeActiveProfile(requestedProfile);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('changeActiveEntities()', () => {
      it('should change active entities', async () => {
        const requestedEntity = '1';
        const expectedCode = 200;
        const expectedBody = '"true"';
        const expectedPostBody = { entities_id : requestedEntity, is_recursive : 'false' };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveEntities', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.changeActiveEntities(requestedEntity);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data', 'true');
      });

      it('should select all entities (id = 0)', async () => {
        const requestedEntity = '0';
        const expectedCode = 200;
        const expectedBody = '"true"';
        const expectedPostBody = { entities_id : requestedEntity, is_recursive : 'false' };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveEntities', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.changeActiveEntities(requestedEntity);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data', 'true');
      });

      it('should select all entities (no id)', async () => {
        const expectedCode = 200;
        const expectedBody = '"true"';
        const expectedPostBody = { is_recursive : 'false' };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveEntities', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.changeActiveEntities();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data', 'true');
      });

      it('should throw a ServerError 400 if entity is not valid', async () => {
        const requestedEntity = '999';
        const expectedCode = 400;
        const expectedBody = [
          'ERROR',
          `Bad Request; Afficher la documentation dans votre navigateur à ${config.userToken.apiurl}/#ERROR`
        ];
        const expectedPostBody = { entities_id : requestedEntity, is_recursive : 'false' };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/changeActiveEntities', expectedPostBody)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.changeActiveEntities(requestedEntity);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('addItems()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const data = { name : 'Lorem ipsum' };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.addItems('Ticket', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should throw InvalidItemTypeError', async () => {
        const data = { name : 'Lorem ipsum' };
        try {
          const result = await glpi.addItems('Bogus', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidItemTypeError);
        }
      });

      it('should add a Ticket', async () => {
        const data = { name : 'Lorem ipsum' };
        const id = '1802200547';
        const message = `Votre ticket a bien été enregistré, son traitement est en cours. (Ticket : ${id})`;
        const expectedCode = 201;
        const expectedBody = { id, message };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.addItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should add 3 Tickets', async () => {
        const data = [{ name : 'Lorem ipsum' }, { name : 'Lorem ipsum' }, { name : 'Lorem ipsum' }];
        const ids = ['1802200547', '1802200548', '1802200549'];
        const expectedCode = 201;
        const expectedBody = ids.map((id) => {
          const message = `Votre ticket a bien été enregistré, son traitement est en cours. (Ticket : ${id})`;
          return { id, message };
        });
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.addItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should add a GLPI 11 plugin item with URL-encoded backslashes in endpoint', async () => {
        const data = { name : 'New Client' };
        const id = 123;
        const expectedCode = 201;
        const expectedBody = { id, message: 'Item successfully added' };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/GlpiPlugin%5CShipping%5CClient', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.addItems('GlpiPlugin\\Shipping\\Client', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should throw InvalidParameterError', async () => {
        try {
          const result = await glpi.addItems('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });
    });

    describe('updateItems()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const id = '1802200547';
        const data = { status : 6 };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put(`/Ticket/${id}`, expectedPostBody)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.updateItems('Ticket', id, data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should throw InvalidItemTypeError', async () => {
        try {
          const result = await glpi.updateItems('Bogus', 1);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidItemTypeError);
        }
      });

      it('should throw InvalidParameterError (no id and no data)', async () => {
        try {
          const result = await glpi.updateItems('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should throw InvalidParameterError (no data)', async () => {
        try {
          const id = '1802200547';
          const result = await glpi.updateItems('Ticket', id);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should throw InvalidParameterError (data object with no id)', async () => {
        try {
          const data = { status : 6 };
          const result = await glpi.updateItems('Ticket', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should throw InvalidParameterError (data array of object with no id)', async () => {
        try {
          const data = [
            { 'status' : 6 },
            { 'status' : 3 },
            { 'status' : 4 },
          ];
          const result = await glpi.updateItems('Ticket', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should update the status of the Ticket (id in URL)', async () => {
        const data = { status : 6 };
        const id = '1802200547';
        const expectedCode = 200;
        const expectedBody = { id, message : '' };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put(`/Ticket/${id}`, expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.updateItems('Ticket', id, data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should update the status of the Ticket (id in body)', async () => {
        const id = '1802200547';
        const data = { status : 6, id };
        const expectedCode = 200;
        const expectedBody = { id, message : '' };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.updateItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should update the status of 3 Tickets', async () => {
        const data = [
          { 'id': '1802200589', 'status' : 6 },
          { 'id': '1802200588', 'status' : 3 },
          { 'id': '1802200586', 'status' : 4 },
        ];
        const expectedCode = 200;
        const expectedBody = [
          { '1802200589': true, 'message': '' },
          { '1802200588': true, 'message': '' },
          { '1802200586': true, 'message': '' },
        ];
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.updateItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should update the status of 2 Tickets and return an ERROR_GLPI_PARTIAL_UPDATE error', async () => {
        const data = [
          { 'id': '1802200589', 'status' : 6 },
          { 'id': '1802200588', 'status' : 3 },
          { 'id': '1802200', 'status' : 4 },
        ];
        const expectedCode = 207;
        const expectedBody = [
          'ERROR_GLPI_PARTIAL_UPDATE',
          [
            { '1802200589': true, 'message': '' },
            { '1802200588': true, 'message': '' },
          ]
        ];
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put('/Ticket', expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.updateItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should update a GLPI 11 plugin item with URL-encoded backslashes in endpoint', async () => {
        const data = { name : 'Updated Client' };
        const id = 42;
        const expectedCode = 200;
        const expectedBody = { id, message: '' };
        const expectedPostBody = { input : data };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .put(`/GlpiPlugin%5CShipping%5CClient/${id}`, expectedPostBody)
        .reply(expectedCode, expectedBody);

        const result = await glpi.updateItems('GlpiPlugin\\Shipping\\Client', id, data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('deleteItems()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const id = '1802200547';
        const query = {
          force_purge : false,
          history     : true,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete(`/Ticket/${id}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.deleteItems('Ticket', id);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should throw InvalidItemTypeError', async () => {
        try {
          const result = await glpi.deleteItems('Bogus', 1);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidItemTypeError);
        }
      });

      it('should throw InvalidParameterError (no id no data)', async () => {
        try {
          const result = await glpi.deleteItems('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should throw InvalidParameterError (data object with no id)', async () => {
        try {
          const data = {};
          const result = await glpi.deleteItems('Ticket', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should throw InvalidParameterError (data array of object with no id)', async () => {
        try {
          const data = [
            {},
            {},
            {},
          ];
          const result = await glpi.deleteItems('Ticket', data);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(InvalidParameterError);
        }
      });

      it('should delete one Ticket (id in URL)', async () => {
        const id = '1802200547';
        const query = {
          force_purge : false,
          history     : true,
        };
        const expectedCode = 200;
        const expectedBody = [
          {
            [id]: true,
            message: '',
          }
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete(`/Ticket/${id}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.deleteItems('Ticket', id);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should delete one Ticket (id in body)', async () => {
        const id = '1802200547';
        const data = { id };
        const query = {
          force_purge : false,
          history     : true,
        };
        const expectedCode = 200;
        const expectedBody = [
          {
            [id]: true,
            message: '',
          }
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete('/Ticket', { input : data })
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.deleteItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should delete 3 Tickets', async () => {
        const data = [
          { 'id': '1802200589' },
          { 'id': '1802200588' },
          { 'id': '1802200586' },
        ];
        const query = {
          force_purge : false,
          history     : true,
        };
        const expectedCode = 200;
        const expectedBody = [
          { '1802200589': true, 'message': '' },
          { '1802200588': true, 'message': '' },
          { '1802200586': true, 'message': '' },
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete('/Ticket', { input : data })
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.deleteItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should 2 Tickets and return an ERROR_GLPI_PARTIAL_DELETE error', async () => {
        const data = [
          { 'id': '1802200589' },
          { 'id': '1802200588' },
          { 'id': '1802200' },
        ];
        const query = {
          force_purge : false,
          history     : true,
        };
        const expectedCode = 207;
        const expectedBody = [
          'ERROR_GLPI_PARTIAL_DELETE',
          [
            { '1802200589': true, 'message': '' },
            { '1802200588': true, 'message': '' },
            { '1802200': false, 'message': 'Élément introuvable' },
          ]
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete('/Ticket', { input : data })
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.deleteItems('Ticket', data);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });

      it('should delete a GLPI 11 plugin item with URL-encoded backslashes in endpoint', async () => {
        const id = 42;
        const query = {
          force_purge : false,
          history     : true,
        };
        const expectedCode = 200;
        const expectedBody = [
          {
            [id]: true,
            message: '',
          }
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .delete(`/GlpiPlugin%5CShipping%5CClient/${id}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.deleteItems('GlpiPlugin\\Shipping\\Client', id);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('upload()', () => {
      it('should throw a FileNotReadableError', async () => {
        try {
          const result = await glpi.upload('not_existing_file.txt', 'comment');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(FileNotReadableError);
        }
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];

        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Document')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.upload(path.resolve(__dirname, '../test.txt'), 'comment');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should upload a file', async () => {
        const expectedCode = 200;
        const expectedBody = upload;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Document')
        .reply(expectedCode, expectedBody);

        const result = await glpi.upload(path.resolve(__dirname, '../test.txt'), 'comment');

        expect(result).to.have.property('code', expectedCode);
        expect(JSON.stringify(result.data)).to.be.equal(JSON.stringify(expectedBody));
      });


      it('should upload a file (new way)', async () => {
        const expectedCode = 200;
        const expectedBody = upload_custom_filename;
        const expectedName = 'my_custom_name.txt';
        const expectedMime = 'plain/text';
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Document')
        .reply(expectedCode, expectedBody);

        const result = await glpi.upload({
          filePath: path.resolve(__dirname, '../test.txt'),
          fileName: expectedName,
          fileType: expectedMime,
        }, 'comment');

        expect(result).to.have.property('code', expectedCode);
        expect(JSON.stringify(result.data)).to.be.equal(JSON.stringify(expectedBody));
      });

      it('should upload a file without comment', async () => {
        const expectedCode = 200;
        const expectedBody = upload_without_comment;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .post('/Document')
        .reply(expectedCode, expectedBody);

        const result = await glpi.upload(path.resolve(__dirname, '../test.txt'));

        expect(result).to.have.property('code', expectedCode);
        expect(JSON.stringify(result.data)).to.be.equal(JSON.stringify(expectedBody));
      });

    });
  });

  describe('GET methods', () => {
    describe('killSession()', () => {
      it('should log out successfully', async () => {
        const expectedCode = 200;
        const expectedBody = {};
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/killSession')
        .reply(expectedCode, expectedBody);

        const result = await glpi.killSession();
        expect(result).to.have.property('code', expectedCode);
        expect(glpi._session).to.be.equal('');
      });


      it('should ignore log out if no session', async () => {
        try {
          delete glpi._session;
          const result = await glpi.killSession();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(SessionNotFoundError);
        }
      });

      it('should throw a ServerError with code 401 if session_token does not match', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/killSession')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.killSession();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getMyProfiles()', () => {
      it('should fetch my profiles', async () => {
        const expectedCode = 200;
        const expectedBody = myProfiles;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMyProfiles')
        .reply(expectedCode, expectedBody);

        const result = await glpi.getMyProfiles();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(myProfiles.myprofiles);
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMyProfiles')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getMyProfiles();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getActiveProfile()', () => {
      it('should return my active profile', async () => {
        const expectedCode = 200;
        const expectedBody = activeProfile;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getActiveProfile')
        .reply(expectedCode, expectedBody);

        const result = await glpi.getActiveProfile();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(activeProfile.active_profile);
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getActiveProfile')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getActiveProfile();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getMyEntities()', () => {
      it('should return my entities', async () => {
        const expectedCode = 200;
        const expectedBody = myEntities;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMyEntities')
        .reply(expectedCode, expectedBody);

        const result = await glpi.getMyEntities();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(myEntities.myentities);
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMyEntities')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getMyEntities();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getActiveEntities()', () => {
      it('should return all active entities', async () => {
        const expectedCode = 200;
        const expectedBody = activeEntitiesAll;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getActiveEntities')
        .reply(expectedCode, expectedBody);

        const result = await glpi.getActiveEntities();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(activeEntitiesAll.active_entity);
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getActiveEntities')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getActiveEntities();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getFullSession()', () => {
      it('should return the current full session', async () => {
        const expectedCode = 200;
        const expectedBody = fullSession;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getFullSession')
        .reply(expectedCode, expectedBody);

        const result = await glpi.getFullSession();
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(fullSession.session);
      });

      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getFullSession')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getFullSession();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });
    });

    describe('getItem()', () => {
      it('should throw a ServerError', async () => {
        const requestedTicketId = 123456;
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const query = {
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Ticket/${requestedTicketId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getItem('Ticket', requestedTicketId);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should return the expected ticket with default options', async () => {
        const requestedTicketId = 123456;
        const expectedCode = 200;
        const expectedBody = itemTicketDefault;
        const query = {
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Ticket/${requestedTicketId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('Ticket', requestedTicketId);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(itemTicketDefault);
      });

      it('should return the expected ticket with expanded dropdowns', async () => {
        const requestedTicketId = 123456;
        const expectedCode = 200;
        const expectedBody = itemTicketExpandedDropdowns;
        const query = {
          expand_dropdowns  : true,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Ticket/${requestedTicketId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('Ticket', requestedTicketId, { expand_dropdowns : true });
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(itemTicketExpandedDropdowns);
      });

      it('should return the expected ticket without HATEOAS', async () => {
        const requestedTicketId = 123456;
        const expectedCode = 200;
        const expectedBody = itemTicketWithoutHateoas;
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : false,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Ticket/${requestedTicketId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('Ticket', requestedTicketId, { get_hateoas : false });
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(itemTicketWithoutHateoas);
      });

      it('should return the SHA1 of the expected ticket', async () => {
        const requestedTicketId = 123456;
        const expectedSha1 = '8ac3900bbcc7752b22500ead42789f6f1f757c7d';
        const expectedCode = 200;
        const expectedBody = `"${expectedSha1}"`;
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          get_sha1          : true,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Ticket/${requestedTicketId}`)
        .query(query)
        .reply(expectedCode,  expectedBody);

        const result = await glpi.getItem('Ticket', requestedTicketId, { get_sha1 : true });
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data', expectedSha1);
      });

      it('should return the expected computer', async () => {
        const requestedComputerId = 11640;
        const expectedCode = 200;
        const expectedBody = itemComputerDefault;
        const query = {
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Computer/${requestedComputerId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('Computer', requestedComputerId);

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(itemComputerDefault);
      });

      it('should return the expected computer with its devices', async () => {
        const requestedComputerId = 11640;
        const expectedCode = 200;
        const expectedBody = itemComputerWithDevices;
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          get_sha1          : false,
          with_devices      : true,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/Computer/${requestedComputerId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('Computer', requestedComputerId, { with_devices : true });

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.nested.property('data.id', requestedComputerId);
        expect(result).to.have.property('data').to.deep.equal(itemComputerWithDevices);
      });

      it('should fetch a GLPI 11 plugin item with URL-encoded backslashes in endpoint', async () => {
        const requestedId = 42;
        const expectedCode = 200;
        const expectedBody = { id: 42, name: 'Client A' };
        const query = {
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get(`/GlpiPlugin%5CShipping%5CClient/${requestedId}`)
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.getItem('GlpiPlugin\\Shipping\\Client', requestedId);
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('getItems()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          only_id           : false,
          range             : '0-50',
          sort              : 'id',
          order             : 'DESC',
          searchText        : '',
          is_deleted        : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getItems('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should return 10 tickets ordered by ascending id (no options)', async () => {
        const expectedCode = 200;
        const expectedBody = _.slice(_.orderBy(itemTickets, ['id'], ['asc']), 0, 10);
        const expectedHeaders = { 'Content-Range' : '0-50/250', 'Accept-Range' : 'Ticket 1000' };
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          only_id           : false,
          range             : '0-50',
          sort              : 'id',
          order             : 'DESC',
          searchText        : '',
          is_deleted        : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody, expectedHeaders);

        const result = await glpi.getItems('Ticket');

        const rawIds = _.map(result.data, 'id');
        const orderedIds = _.map(_.orderBy(result.data, ['id'], ['asc']), 'id');

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.nested.property('range.min', 0);
        expect(result).to.have.nested.property('range.max', 50);
        expect(result).to.have.nested.property('range.total', 250);
        expect(result).to.have.property('data').which.is.an('array').of.length(10);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
        expect(rawIds).to.be.an('array').of.length(10);
        expect(orderedIds).to.be.an('array').of.length(10);
        expect(JSON.stringify(rawIds)).to.be.equal(JSON.stringify(orderedIds));
      });

      it('should return 10 tickets ordered by ascending id ', async () => {
        const expectedCode = 200;
        const expectedBody = _.slice(_.orderBy(itemTickets, ['id'], ['asc']), 0, 10);
        const expectedHeaders = { 'Content-Range' : '0-10/250', 'Accept-Range' : 'Ticket 1000' };
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          only_id           : false,
          range             : '0-10',
          sort              : 'id',
          order             : 'ASC',
          searchText        : '',
          is_deleted        : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody, expectedHeaders);

        const result = await glpi.getItems('Ticket', {
          range : '0-10',
          sort  : 'id',
          order : 'ASC',
        });

        const rawIds = _.map(result.data, 'id');
        const orderedIds = _.map(_.orderBy(result.data, ['id'], ['asc']), 'id');

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.nested.property('range.min', 0);
        expect(result).to.have.nested.property('range.max', 10);
        expect(result).to.have.nested.property('range.total', 250);
        expect(result).to.have.property('data').which.is.an('array').of.length(10);
        expect(rawIds).to.be.an('array').of.length(10);
        expect(orderedIds).to.be.an('array').of.length(10);
        expect(JSON.stringify(rawIds)).to.be.equal(JSON.stringify(orderedIds));
      });

      it('should return tickets 50 to 100 ordered by descending id without HATEOAS', async () => {
        const expectedCode = 200;
        const expectedBody = _.slice(_.orderBy( _.transform(itemTickets, (r, o) => { delete o.links; r.push(o); }, []) , ['id'], ['desc']), 50, 100);
        const nbResultsTotal = itemTickets.length;
        const nbResultsExpected = nbResultsTotal > 50 ? 50 : nbResultsTotal;
        const expectedHeaders = { 'Content-Range' : `50-100/${nbResultsTotal}`, 'Accept-Range' : 'Ticket 1000' };
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : false,
          only_id           : false,
          range             : '50-100',
          sort              : 'id',
          order             : 'DESC',
          searchText        : '',
          is_deleted        : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody, expectedHeaders);

        const result = await glpi.getItems('Ticket', {
          range       : '50-100',
          sort        : 'id',
          order       : 'DESC',
          get_hateoas : false,
        });

        const rawIds = _.map(result.data, 'id');
        const orderedIds = _.map(_.orderBy(result.data, ['id'], ['desc']), 'id');

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.nested.property('range.min', 50);
        expect(result).to.have.nested.property('range.max', 100);
        expect(result).to.have.nested.property('range.total', +nbResultsTotal);
        expect(result).to.have.property('data').which.is.an('array').of.length(nbResultsExpected);
        expect(rawIds).to.be.an('array').of.length(nbResultsExpected);
        expect(orderedIds).to.be.an('array').of.length(nbResultsExpected);
        expect(JSON.stringify(rawIds)).to.be.equal(JSON.stringify(orderedIds));
        expect(result).to.not.have.deep.nested.property('data[0].links');
      });

      it('should fetch GLPI 11 plugin items with URL-encoded backslashes in endpoint', async () => {
        const expectedCode = 200;
        const expectedBody = [{ id: 1, name: 'Client 1' }, { id: 2, name: 'Client 2' }];
        const expectedHeaders = { 'Content-Range' : '0-2/2', 'Accept-Range' : 'GlpiPlugin\\Shipping\\Client 1000' };
        const query = {
          expand_dropdowns  : false,
          get_hateoas       : true,
          only_id           : false,
          range             : '0-50',
          sort              : 'id',
          order             : 'DESC',
          searchText        : '',
          is_deleted        : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/GlpiPlugin%5CShipping%5CClient')
        .query(query)
        .reply(expectedCode, expectedBody, expectedHeaders);

        const result = await glpi.getItems('GlpiPlugin\\Shipping\\Client');
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('getSubItems()', () => {
      describe('With item type as string', () => {
        it('should throw a ServerError', async () => {
          const requestedTicketId = 123456;
          const expectedCode = 401;
          const expectedBody = [
            'ERROR_SESSION_TOKEN_INVALID',
            'session_token semble incorrect',
          ];
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-5',
            sort             : 'date_mod',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/Ticket/${requestedTicketId}/Log`)
          .query(query)
          .reply(expectedCode, expectedBody);

          try {
            const result = await glpi.getSubItems('Ticket', requestedTicketId, 'Log', {
              range : '0-5',
              sort  : 'date_mod',
              order : 'DESC',
            });
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.an.instanceOf(ServerError);
            expect(err).to.have.property('code', expectedCode);
            expect(err).to.have.property('message', expectedBody[0]);
            expect(err).to.have.property('comment', expectedBody[1]);
          }
        });

        it('should return logs of requested ticket', async () => {
          const expectedCode = 200;
          const expectedBody = _.slice(_.orderBy(itemTicketLogDefault, ['date_mod'], ['desc']), 0, 5);
          const requestedTicketId = 123456;
          const nbResultsTotal = itemTicketLogDefault.length;
          const nbResultsExpected = nbResultsTotal > 5 ? 5 : nbResultsTotal;
          const expectedHeaders = { 'Content-Range' : `0-5/${nbResultsTotal}`, 'Accept-Range' : 'Log 1000' };
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-5',
            sort             : 'date_mod',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/Ticket/${requestedTicketId}/Log`)
          .query(query)
          .reply(expectedCode, expectedBody, expectedHeaders);

          const result = await glpi.getSubItems('Ticket', requestedTicketId, 'Log', {
            range : '0-5',
            sort  : 'date_mod',
            order : 'DESC',
          });

          const rawIds = _.map(result.data, 'id');
          const orderedIds = _.map(_.orderBy(result.data, ['date_mod'], ['desc']), 'id');

          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.nested.property('range.min', 0);
          expect(result).to.have.nested.property('range.max', 5);
          expect(result).to.have.nested.property('range.total', +nbResultsTotal);
          expect(result).to.have.property('data').which.is.an('array').of.length(nbResultsExpected);
          expect(result).to.have.property('data').to.deep.equal(expectedBody);
          expect(rawIds).to.be.an('array').of.length(nbResultsExpected);
          expect(orderedIds).to.be.an('array').of.length(nbResultsExpected);
          expect(JSON.stringify(rawIds)).to.be.equal(JSON.stringify(orderedIds));
        });

        it('should return subitems of a GLPI 11 plugin', async () => {
          const expectedCode = 200;
          const expectedBody = [{ id: 10, name: 'Order 10' }];
          const requestedClientId = 42;
          const expectedHeaders = { 'Content-Range': '0-1/1', 'Accept-Range': 'GlpiPlugin\\Shipping\\Order 1000' };
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-50',
            sort             : 'id',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/GlpiPlugin%5CShipping%5CClient/${requestedClientId}/GlpiPlugin%5CShipping%5COrder`)
          .query(query)
          .reply(expectedCode, expectedBody, expectedHeaders);

          const result = await glpi.getSubItems('GlpiPlugin\\Shipping\\Client', requestedClientId, 'GlpiPlugin\\Shipping\\Order');
          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.property('data').to.deep.equal(expectedBody);
        });

        it('should throw MissingItemTypeError without sub item type provided', async () => {
          const requestedTicketId = 123456;
          try {
            const result = await glpi.getSubItems('Ticket', requestedTicketId);
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.instanceOf(MissingItemTypeError);
          }
        });
      });


      describe('With item as object', () => {
        it('should throw a ServerError', async () => {
          const requestedTicket = deepClone(itemTicketDefault);
          const expectedCode = 401;
          const expectedBody = [
            'ERROR_SESSION_TOKEN_INVALID',
            'session_token semble incorrect',
          ];
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-50',
            sort             : 'id',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/RequestType/${requestTypePhone.id}`)
          .query(query)
          .reply(expectedCode, expectedBody);

          try {
            const result = await glpi.getSubItems(requestedTicket, 'RequestType');
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.an.instanceOf(ServerError);
            expect(err).to.have.property('code', expectedCode);
            expect(err).to.have.property('message', expectedBody[0]);
            expect(err).to.have.property('comment', expectedBody[1]);
          }
        });

        it('should return the requestType of requested ticket', async () => {
          const requestedTicket = deepClone(itemTicketDefault);
          const expectedCode = 200;
          const expectedBody = requestTypePhone;
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-50',
            sort             : 'id',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/RequestType/${requestTypePhone.id}`)
          .query(query)
          .reply(expectedCode, expectedBody);

          const result = await glpi.getSubItems(requestedTicket, 'RequestType');
          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.nested.property('data.id', requestTypePhone.id);
          expect(result).to.have.nested.property('data.name', requestTypePhone.name);
        });

        it('should return followups of requested ticket', async () => {
          const requestedTicket = deepClone(itemTicketDefault);
          const expectedCode = 200;
          const expectedBody = _.slice(_.orderBy(itemTicketTasksDefault, ['date_mod'], ['desc']), 0, 5);
          const nbResultsTotal = itemTicketTasksDefault.length;
          const nbResultsExpected = nbResultsTotal > 5 ? 5 : nbResultsTotal;
          const expectedHeaders = { 'Content-Range' : `0-5/${nbResultsTotal}`, 'Accept-Range' : 'TicketTask 1000' };
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-5',
            sort             : 'date_mod',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get(`/Ticket/${requestedTicket.id}/TicketTask`)
          .query(query)
          .reply(expectedCode, expectedBody, expectedHeaders);

          const result = await glpi.getSubItems(requestedTicket, 'TicketTask', {
            range : '0-5',
            sort  : 'date_mod',
            order : 'DESC',
          });

          const rawIds = _.map(result.data, 'id');
          const orderedIds = _.map(_.orderBy(result.data, ['date_mod'], ['desc']), 'id');

          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.nested.property('range.min', 0);
          expect(result).to.have.nested.property('range.max', 5);
          expect(result).to.have.nested.property('range.total', +nbResultsTotal);
          expect(result).to.have.property('data').which.is.an('array').of.length(nbResultsExpected);
          expect(rawIds).to.be.an('array').of.length(nbResultsExpected);
          expect(orderedIds).to.be.an('array').of.length(nbResultsExpected);
          expect(JSON.stringify(rawIds)).to.be.equal(JSON.stringify(orderedIds));
        });

        it('should return subitems of a GLPI 11 plugin via HATEOAS links', async () => {
          const pluginItem = {
            id: 42,
            name: 'Client 42',
            links: [
              {
                rel: 'GlpiPlugin\\Shipping\\Order',
                href: `${config.userToken.apiurl}/GlpiPlugin%5CShipping%5COrder/42`,
              },
            ],
          };
          const expectedCode = 200;
          const expectedBody = [{ id: 10, name: 'Order 10' }];
          const query = {
            expand_dropdowns : false,
            get_hateoas      : true,
            only_id          : false,
            range            : '0-50',
            sort             : 'id',
            order            : 'DESC',
          };
          nock(config.userToken.apiurl)
          .matchHeader('app-token', config.userToken.app_token)
          .matchHeader('session-token', sessionToken)
          .get('/GlpiPlugin%5CShipping%5COrder/42')
          .query(query)
          .reply(expectedCode, expectedBody);

          const result = await glpi.getSubItems(pluginItem, 'GlpiPlugin\\Shipping\\Order');
          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.property('data').to.deep.equal(expectedBody);
        });

        it('should throw MissingHATEOASError with ticket as object with no links', async () => {
          const requestedTicket = deepClone(itemTicketDefault);
          delete requestedTicket.links;
          try {
            const result = await glpi.getSubItems(requestedTicket, 'Log');
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.instanceOf(MissingHATEOASError);
          }
        });

        it('should throw MissingHATEOASError with ticket as object without requested link', async () => {
          const requestedTicket = itemTicketDefault;
          try {
            const result = await glpi.getSubItems(requestedTicket, 'Log');
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.instanceOf(MissingHATEOASError);
          }
        });

        it('should throw MissingItemTypeError with ticket as object without sub item type', async () => {
          const requestedTicket = itemTicketDefault;
          try {
            const result = await glpi.getSubItems(requestedTicket);
            expect(result).to.be.undefined;
          } catch(err) {
            expect(err).to.be.instanceOf(MissingItemTypeError);
          }
        });
      });
    });

    describe('getMultipleItems()', () => {
      it('should throw a ServerError', async () => {
        const requestedTicketId = 123456;
        const requestedUserId = 135841;
        const requestedItems = [{
          itemtype : 'Ticket',
          items_id : requestedTicketId,
        }, {
          itemtype : 'User',
          items_id : requestedUserId,
        }];
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const query = {
          items             : requestedItems,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMultipleItems')
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getMultipleItems({
            items : requestedItems,
          });
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should throw InvalidParameterError', async () => {
        try {
          const result = await glpi.getMultipleItems();
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.instanceOf(Error).with.property('name', 'InvalidParameterError');
        }
      });

      it('should return a ticket and a user', async () => {
        const expectedCode = 200;
        const expectedBody = itemMultipleTicketUser;
        const requestedTicketId = 123456;
        const requestedUserId = 135841;
        const requestedItems = [{
          itemtype : 'Ticket',
          items_id : requestedTicketId,
        }, {
          itemtype : 'User',
          items_id : requestedUserId,
        }];
        const query = {
          items             : requestedItems,
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
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/getMultipleItems')
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.getMultipleItems({
            items : requestedItems,
          });

          expect(result).to.have.property('code', expectedCode);
          expect(result).to.have.property('data').to.deep.equal(itemMultipleTicketUser);

        } catch(err) {
          expect(err).to.be.undefined;
        }
      });
    });

    describe('listSearchOptions()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/listSearchOptions/Ticket')
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.listSearchOptions('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should return search options for Ticket (not raw)', async () => {
        const expectedCode = 200;
        const expectedBody = searchOptionsTicket;
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/listSearchOptions/Ticket')
        .reply(expectedCode, expectedBody);

        const result = await glpi.listSearchOptions('Ticket');

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(searchOptionsTicket);
      });


      it('should return search options for Ticket (raw)', async () => {
        const expectedCode = 200;
        const expectedBody = searchOptionsTicketRaw;
        const query = {
          raw : true,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/listSearchOptions/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.listSearchOptions('Ticket', true);

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(searchOptionsTicketRaw);
      });

      it('should return search options for a GLPI 11 plugin', async () => {
        const expectedCode = 200;
        const expectedBody = { 1: { name: 'Name' }, 2: { name: 'ID' } };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/listSearchOptions/GlpiPlugin%5CShipping%5CClient')
        .reply(expectedCode, expectedBody);

        const result = await glpi.listSearchOptions('GlpiPlugin\\Shipping\\Client');
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('search()', () => {
      it('should throw a ServerError', async () => {
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_SESSION_TOKEN_INVALID',
          'session_token semble incorrect',
        ];
        const query = {
          sort         : 'id',
          order        : 'DESC',
          rawdata      : false,
          withindexes  : false,
          uid_cols     : false,
          giveItems    : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/search/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.search('Ticket');
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should return no search result if no criteria', async () => {
        const expectedCode = 200;
        const expectedBody = searchTicketNoOpts;
        const query = {
          sort         : 'id',
          order        : 'DESC',
          rawdata      : false,
          withindexes  : false,
          uid_cols     : false,
          giveItems    : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/search/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.search('Ticket');

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(searchTicketNoOpts);
      });

      it('should return search result for requested ticket (search by ticket id)', async () => {
        const expectedCode = 200;
        const expectedBody = searchTicket;
        const criteria = [{
          link       : 'AND',
          itemtype   : 'Ticket',
          field      : 23,
          searchtype : 'contains',
          value      : 123456,
        }];
        const query = {
          criteria,
          sort         : 'id',
          order        : 'DESC',
          rawdata      : false,
          withindexes  : false,
          uid_cols     : false,
          giveItems    : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/search/Ticket')
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.search('Ticket', { criteria });

        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(searchTicket);
      });

      it('should return search result for a GLPI 11 plugin', async () => {
        const expectedCode = 200;
        const expectedBody = { totalcount: 1, data: [{ 1: 'Client 1' }] };
        const query = {
          sort         : 'id',
          order        : 'DESC',
          rawdata      : false,
          withindexes  : false,
          uid_cols     : false,
          giveItems    : false,
        };
        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .get('/search/GlpiPlugin%5CShipping%5CClient')
        .query(query)
        .reply(expectedCode, expectedBody);

        const result = await glpi.search('GlpiPlugin\\Shipping\\Client');
        expect(result).to.have.property('code', expectedCode);
        expect(result).to.have.property('data').to.deep.equal(expectedBody);
      });
    });

    describe('download()', () => {
      it('should download a file content', async () => {
        const documentId = 123;
        const fileContent = fs.readFileSync(path.resolve(__dirname, '../test.txt'));
        const expectedCode = 200;
        const expectedBody = Buffer.from(fileContent).toString();

        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .matchHeader('accept', 'application/octet-stream')
        .get(`/Document/${documentId}`)
        .reply(expectedCode, expectedBody);

        const result = await glpi.download(documentId);

        expect(result).to.have.property('code', expectedCode);
        expect(result.data).to.be.equal(expectedBody);
      });

      it('should throw a ServerError (ERROR_ITEM_NOT_FOUND)', async () => {
        const documentId = 123;
        const expectedCode = 401;
        const expectedBody = [
          'ERROR_ITEM_NOT_FOUND',
          'Élément introuvable',
        ];

        nock(config.userToken.apiurl)
        .matchHeader('app-token', config.userToken.app_token)
        .matchHeader('session-token', sessionToken)
        .matchHeader('accept', 'application/octet-stream')
        .get(`/Document/${documentId}`)
        .reply(expectedCode, expectedBody);

        try {
          const result = await glpi.download(documentId);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(ServerError);
          expect(err).to.have.property('code', expectedCode);
          expect(err).to.have.property('message', expectedBody[0]);
          expect(err).to.have.property('comment', expectedBody[1]);
        }
      });

      it('should throw an InvalidParameterError', async () => {
        const documentId = 'invalid_id';

        try {
          const result = await glpi.download(documentId);
          expect(result).to.be.undefined;
        } catch(err) {
          expect(err).to.be.an.instanceOf(InvalidParameterError);
        }
      });
    });
  });

  describe('Forbidden methods', () => {
    it('should throw a InvalidHTTPMethodError', async () => {
      try {
        const result = await glpi._request('PATCH', '/Fake');
        expect(result).to.be.undefined;
      } catch(err) {
        expect(err).to.be.an.instanceOf(InvalidHTTPMethodError);
      }
    });
  });
});
