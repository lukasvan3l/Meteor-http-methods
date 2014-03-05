/*

GET /note
GET /note/:id
POST /note
PUT /note/:id
DELETE /note/:id

*/

// Weak dependency on the accounts-base package
Accounts = Package['accounts-base'] && Package['accounts-base'].Accounts;

// Weak depencendy on the http package - we extend the namespace - we should
// prop get our own namespace like XHTTP or something
HTTP = Package.http && Package.http.HTTP || {};

var url = Npm.require('url');

// Primary local test scope
_methodHTTP = {};


_methodHTTP.methodHandlers = {};
_methodHTTP.methodTree = {};

// This could be changed eg. could allow larger data chunks than 1.000.000
// 5mb = 5 * 1024 * 1024 = 5242880;
_methodHTTP.maxDataLength = 5242880; //1e6;

_methodHTTP.nameFollowsConventions = function(name) {
  // Check that name is string, not a falsy or empty
  return name && name === '' + name && name !== '';
};


_methodHTTP.getNameList = function(name) {
  // Remove leading and trailing slashes and make command array
  name = name && name.replace(/^\//g, '') || ''; // /^\/|\/$/g
  // TODO: Get the format from the url - eg.: "/list/45.json" format should be
  // set in this function by splitting the last list item by . and have format
  // as the last item. How should we toggle:
  // "/list/45/item.name.json" and "/list/45/item.name"?
  // We would either have to check all known formats or allways determin the "."
  // as an extension. Resolving in "json" and "name" as handed format - the user
  // Could simply just add the format as a parametre? or be explicit about
  // naming
  return name && name.split('/') || [];
};

// Merge two arrays one containing keys and one values
_methodHTTP.createObject = function(keys, values) {
  var result = {};
  if (keys && values) {
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = values[i] && decodeURIComponent(values[i]) || '';
    }
  }
  return result;
};

_methodHTTP.addToMethodTree = function(methodName) {
  var list = _methodHTTP.getNameList(methodName);
  var name = '/';
  // Contains the list of params names
  var params = [];
  var currentMethodTree = _methodHTTP.methodTree;

  for (var i = 0; i < list.length; i++) {
    var lastListItem = (i === list.length - 1);

    // get the key name
    var key = list[i];
    // Check if it expects a value
    if (key[0] === ':') {
      // This is a value
      params.push(key.slice(1));
      key = ':value';
    }
    name += key + '/';

    // Set the key into the method tree
    if (typeof currentMethodTree[key] === 'undefined') {
      currentMethodTree[key] = {};
    }

    // Dig deeper
    currentMethodTree = currentMethodTree[key];

  }

  if (_.isEmpty(currentMethodTree[':ref'])) {
    currentMethodTree[':ref'] = {
      name: name,
      params: params
    };
  }

  return currentMethodTree[':ref'];
};

// This method should be optimized for speed since its called on allmost every
// http call to the server so we return null as soon as we know its not a method
_methodHTTP.getMethod = function(name) {
  // Check if the
  if (!_methodHTTP.nameFollowsConventions(name)) {
    return null;
  }
  var list = _methodHTTP.getNameList(name);
  // Check if we got a correct list
  if (!list || !list.length) {
    return null;
  }
  // Set current refernce in the _methodHTTP.methodTree
  var currentMethodTree = _methodHTTP.methodTree;
  // Buffer for values to hand on later
  var values = [];
  // Iterate over the method name and check if its found in the method tree
  for (var i = 0; i < list.length; i++) {
    // get the key name
    var key = list[i];
    // We expect to find the key or :value if not we break
    if (typeof currentMethodTree[key] !== 'undefined' ||
            typeof currentMethodTree[':value'] !== 'undefined') {
      // We got a result now check if its a value
      if (typeof currentMethodTree[key] === 'undefined') {
        // Push the value
        values.push(key);
        // Set the key to :value to dig deeper
        key = ':value';
      }

    } else {
      // Break - method call not found
      return null;
    }

    // Dig deeper
    currentMethodTree = currentMethodTree[key];
  }

  // Extract reference pointer
  var reference = currentMethodTree && currentMethodTree[':ref'];
  if (typeof reference !== 'undefined') {
    return {
      name: reference.name,
      params: _methodHTTP.createObject(reference.params, values)
    };
  } else {
    // Did not get any reference to the method
    return null;
  }
};

// This method retrieves the userId from the token and makes sure that the token
// is valid and not expired
_methodHTTP.getUserId = function() {
  var self = this;
  // Cant really do much without the Accounts package
  if (typeof Accounts === 'undefined')
    console.log('Accounts not installed??');
  if (typeof Accounts === 'undefined')
    return null;

  // // Get ip, x-forwarded-for can be comma seperated ips where the first is the
  // // client ip
  // var ip = self.req.headers['x-forwarded-for'] &&
  //         // Return the first item in ip list
  //         self.req.headers['x-forwarded-for'].split(',')[0] ||
  //         // or return the remoteAddress
  //         self.req.connection.remoteAddress;

  // Check authentication
  var authToken = self.authToken;
  var basicAuth = self.basicAuth;

  // Check if we are handed strings
  try {
    authToken && check(authToken, String);
  } catch(err) {
    throw new Meteor.Error(404, 'Error user token and id not of type strings, Error: ' + (err.stack || err.message));
  }

  // Set the this.userId
  if (typeof authToken !== 'undefined') {
    // Look up user to check if user exists and is loggedin via token
    console.log('User token...');
    var user = Meteor.users.findOne({
        $or: [
          {'services.resume.loginTokens.hashedToken': Accounts._hashLoginToken(authToken)},
          {'services.resume.loginTokens.token': authToken}
        ]
      });
    // TODO: check 'services.resume.loginTokens.when' to have the token expire

    // Set the userId in the scope
    return user && user._id;
  } else if (typeof basicAuth !== 'undefined') {
    // We try to authenticate using the basicAuth and the password package.
    // If we encounter an error etc. we dont pop the login window - simply
    // throw errors instead.
    // We dont use resume tokens - we could set a resume token by updating the
    // user and setting a cookie in the headers. Any ways we provide the tools
    // making it possible to create a login method - that could generate a token
    // and return it to the client.
    // If x-auth headers are set we dont use basicAuth.
    //
    // XXX: do we know if we are on https? we could be behind a proxy etc.
    // If we could we should not allow the user to send plain-text passwords

    // Check the basicAuth object that username and password are valid strings
    try {
      check(basicAuth, {username: String, password: String});
    } catch(err) {
      throw new Meteor.Error(400, 'Bad request');
    }

    // Create the user selector - we allow both use of username and email
    // XXX: Should this only be username?
    var selector = {
      $or: [
        { 'username': basicAuth.username },
        { 'emails.address': basicAuth.username }
      ]
    };

    // Try to find the user
    var user = Meteor.users.findOne(selector);

    // If not found then throw an error
    if (!user)
      throw new Meteor.Error(403, "User not found");

    // Check that the user object contains password
    if (!user.services || !user.services.password ||
        !user.services.password.srp)
      throw new Meteor.Error(403, "User has no password set");

    // Just check the verifier output when the same identity and salt
    // are passed. Don't bother with a full exchange.
    var verifier = user.services.password.srp;

    // Calculate new verifier
    var newVerifier = SRP.generateVerifier(basicAuth.password, {
      identity: verifier.identity, salt: verifier.salt});

    // Match the two verifiers
    if (verifier.verifier !== newVerifier.verifier) {
      throw new Meteor.Error(403, "Incorrect password");
    } else {
      // If we have a match then return the user id
      return user && user._id;
    }

  } // EO basicAuth

  return null;
};


// Public interface for adding server-side http methods - if setting a method to
// 'false' it would actually remove the method (can be used to unpublish a method)
HTTP.methods = function(newMethods) {
  _.each(newMethods, function(func, name) {
    if (_methodHTTP.nameFollowsConventions(name)) {
      // Check if we got a function
      //if (typeof func === 'function') {
        var method = _methodHTTP.addToMethodTree(name);
        // The func is good
        if (typeof _methodHTTP.methodHandlers[method.name] !== 'undefined') {
          if (func === false) {
            // If the method is set to false then unpublish
            delete _methodHTTP.methodHandlers[method.name];
            // Delete the reference in the _methodHTTP.methodTree
            delete method.name;
            delete method.params;
          } else {
            // We should not allow overwriting - following Meteor.methods
            throw new Error('HTTP method "' + name + '" is already registered');
          }
        } else {
          // We could have a function or a object
          // The object could have:
          // '/test/': {
          //   auth: function() ... returning the userId using over default
          //
          //   method: function() ...
          //   or
          //   post: function() ...
          //   put:
          //   get:
          //   delete:
          // }

          /*
          We conform to the object format:
          {
            auth:
            post:
            put:
            get:
            delete:
          }
          This way we have a uniform reference
          */

          var uniObj = {};
          if (typeof func === 'function') {
            uniObj = {
              'useAuth': false,
              'authFunction': _methodHTTP.getUserId,
              'POST': func,
              'PUT': func,
              'GET': func,
              'DELETE': func
            };
          } else {
            uniObj = {
              'useAuth': func.useAuth,
              'authFunction': func.authFunction || _methodHTTP.getUserId,
              'POST': func.post || func.method,
              'PUT': func.put || func.method,
              'GET': func.get || func.method,
              'DELETE': func.delete || func.method
            };
          }

          // Registre the method
          _methodHTTP.methodHandlers[method.name] = uniObj; // func;

        }
      // } else {
      //   // We do require a function as a function to execute later
      //   throw new Error('HTTP.methods failed: ' + name + ' is not a function');
      // }
    } else {
      // We have to follow the naming spec defined in nameFollowsConventions
      throw new Error('HTTP.method "' + name + '" invalid naming of method');
    }
  });
};

var sendError = function(res, code, message) {
  res.writeHead(code);
  res.end(message);
};

// This handler collects the header data into either an object (if json) or the
// raw data. The data is passed to the callback
var requestHandler = function(req, res, callback) {
  if (typeof callback !== 'function') {
    return null;
  }

  // Container for buffers and a sum of the length
  var bufferData = [], dataLen = 0;

  // Extract the body
  req.on('data', function(data) {
    bufferData.push(data);
    dataLen += data.length;

    // We have to check the data length in order to spare the server
    if (dataLen > _methodHTTP.maxDataLength) {
      dataLen = 0;
      bufferData = [];
      // Flood attack or faulty client
      sendError(res, 413, 'Flood attack or faulty client');
      req.connection.destroy();
    }
  });

  // When message is ready to be passed on
  req.on('end', function() {
    if (res.finished) {
      return;
    }

    // Allow the result to be undefined if so
    var result;

    // If data found the work it - either buffer or json
    if (dataLen > 0) {
      result = new Buffer(dataLen);
      // Merge the chunks into one buffer
      for (var i = 0, ln = bufferData.length, pos = 0; i < ln; i++) {
        bufferData[i].copy(result, pos);
        pos += bufferData[i].length;
        delete bufferData[i];
      }
      // Check if we could be dealing with json
      if (result[0] == 0x7b && result[1] === 0x22) {
        try {
          // Convert the body into json and extract the data object
          result = EJSON.parse(result.toString());
        } catch(err) {
          // Could not parse so we return the raw data
        }
      }
    } else {
      // Result will be undefined
    }

    try {
      callback(result);
    } catch(err) {
      sendError(res, 500, 'Error in requestHandler callback, Error: ' + (err.stack || err.message) );
    }
  });

};

// Handle the actual connection
WebApp.connectHandlers.use(function(req, res, next) {


  // Check to se if this is a http method call
  var method = _methodHTTP.getMethod(req._parsedUrl.pathname);

  // If method is null then it wasn't and we pass the request along
  if (method === null) {
    return next();
  }

  var methodReference = method.name;

  var methodObject = _methodHTTP.methodHandlers[methodReference];

  // If methodsHandler not found or somehow the methodshandler is not a
  // function then return a 404
  if (typeof methodObject === 'undefined') {
    sendError(res, 404, 'Error HTTP method handler "' + methodReference + '" is not found');
    return;
  }

  // Rig the basicAuth object
  var basicAuth;

  // Rig the check method - this is a very simple method - we dont want to
  // trigger the popup login dialog
  var handleBasicAuth = WebApp.__basicAuth__(function(u, p) {
    // Make sure user and password are non empty string
    if (u === ''+u && p === ''+p && u !== '' && p !== '') {
      // Update the basicAuth object
      basicAuth = {
        username: u,
        password: p
      };
    }
    return true;
    // XXX: should the realm text be configurable? - We dont actually use this
  }, 'Authorization Required');

  var dontHandleBasicAuth = function(req, res, callback) { callback(); };

  var authHandle = (methodObject.useAuth)? handleBasicAuth: dontHandleBasicAuth;

  // The checker will set the basicAuth if present
  authHandle(req, res, function() {

    requestHandler(req, res, function(data) {

      // Set fiber scope
      var fiberScope = {
        // Pointers to Request / Response
        req: req,
        res: res,
        // Request / Response helpers
        statusCode: 200,
        method: req.method,
        // Headers for response
        headers: {
          'Content-Type': 'text/html'  // Set default type
        },
        // Arguments
        data: data,
        query: req.query,
        params: method.params,
        // Method reference
        reference: methodReference,
        methodObject: methodObject,
        // basic auth
        basicAuth: basicAuth,
        authToken: req.headers['x-auth'] || req.query.token
      };

      // Helper functions this scope
      Fiber = Npm.require('fibers');
      runServerMethod = Fiber(function(self) {
        // We fetch methods data from methodsHandler, the handler uses the this.addItem()
        // function to populate the methods, this way we have better check control and
        // better error handling + messages

        // The scope for the user methodObject callbacks
        var thisScope = {
          // The user whos id and token was used to run this method, if set/found
          userId: null,
          // The id of the data
          _id: null,
          // Set the query params ?token=1&id=2 -> { token: 1, id: 2 }
          query: self.query,
          // Set params /foo/:name/test/:id -> { name: '', id: '' }
          params: self.params,
          // Method GET, PUT, POST, DELETE
          method: self.method,
          // basic auth
          basicAuth: self.basicAuth,
          // x-auth token
          authToken: self.authToken,
          // User agent
          userAgent: req.headers['user-agent'],
          // All request headers
          requestHeaders: req.headers,
          // Set the userId
          setUserId: function(id) {
            this.userId = id;
          },
          // We dont simulate / run this on the client at the moment
          isSimulation: false,
          // Run the next method in a new fiber - This is default at the moment
          unblock: function() {},
          // Set the content type in header, defaults to text/html?
          setContentType: function(type) {
            self.headers['Content-Type'] = type;
          },
          setStatusCode: function(code) {
            self.statusCode = code;
          },
          addHeader: function(key, value) {
            self.headers[key] = value;
          }
        };

        var methodCall = self.methodObject[self.method];

        // If the method call is set for the POST/PUT/GET or DELETE then run the
        // respective methodCall if its a function
        if (typeof methodCall === 'function') {

          // Get the userId - This is either set as a method specific handler and
          // will allways default back to the builtin getUserId handler
          try {
            // Try to set the userId
            thisScope.userId = self.methodObject.authFunction.apply(self);
          } catch(err) {
            sendError(res, err.error, (err.message || err.stack));
            return;
          }

          // Get the result of the methodCall
          var result;
          // Get a result back to send to the client
          try {
            result = methodCall.apply(thisScope, [self.data]) || '';
          } catch(err) {
            if (err instanceof Meteor.Error) {
              // Return controlled error
              sendError(res, err.error, err.message);
            } else {
              // Return error trace - this is not intented
              sendError(res, 503, 'Error in method "' + self.reference + '", Error: ' + (err.stack || err.message) );
            }
            return;
          }

          // If OK / 200 then Return the result
          if (self.statusCode === 200) {
            var resultBuffer = new Buffer(result);
            // Check if user wants to overwrite content length for some reason?
            if (typeof self.headers['Content-Length'] === 'undefined') {
              self.headers['Content-Length'] = resultBuffer.length;
            }
            // Set headers
            _.each(self.headers, function(value, key) {
              self.res.setHeader(key, value);
            });
            // End response
            self.res.end(resultBuffer);
          } else {
            // Set headers
            _.each(self.headers, function(value, key) {
              // If value is defined then set the header, this allows for unsetting
              // the default content-type
              if (typeof value !== 'undefined')
                self.res.setHeader(key, value);
            });
            // Allow user to alter the status code and send a message
            sendError(res, self.statusCode, result);
          }

        } else {
          sendError(res, 404, 'Service not found');
        }


      });
      // Run http methods handler
      try {
        runServerMethod.run(fiberScope);
      } catch(err) {
        sendError(res, 500, 'Error running the server http method handler, Error: ' + (err.stack || err.message));
      }

    }); // EO Request handler

  }); // EO check auth headers sent or not


});
