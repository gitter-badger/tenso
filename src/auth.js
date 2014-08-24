/**
 * Setups up authentication
 *
 * @method auth
 * @param  {Object} obj    Tenso instance
 * @param  {Object} config Tenso configuration
 * @return {Object}        Updated Tenso configuration
 */
function auth ( obj, config ) {
	var ssl       = config.ssl.cert && config.ssl.key,
	    proto     = "http" + ( ssl ? "s" : "" ),
	    realm     = proto + "://" + ( config.hostname === "localhost" ? "127.0.0.1" : config.hostname ) + ( config.port !== 80 && config.port !== 443 ? ":" + config.port : "" ),
	    stateless = ( config.auth.basic.enabled || config.auth.bearer.enabled ),
	    async     = ( !stateless && ( config.auth.facebook.enabled || config.auth.google.enabled || config.auth.linkedin.enabled || config.auth.twitter.enabled ) ),
	    stateful  = ( !stateless && ( async || config.auth.local.enabled ) ),
	    authMap   = {},
	    authUris, sesh, fnCookie, fnSesh, luscaCsrf, luscaCsp, luscaXframe, luscaP3p, luscaHsts, luscaXssProtection, protection, passportAuth, passportInit, passportSession;

	function asyncFlag () {
		arguments[0].protectAsync = true;
		arguments[2]();
	}

	function guard ( req, res, next ) {
		if ( req.isAuthenticated() ) {
			return next();
		}
		else {
			res.redirect( "/login" );
		}
	}

	function redirect () {
		arguments[1].redirect( "/" );
	}

	config.auth.protect = ( config.auth.protect || [] ).map( function ( i ) {
		return new RegExp( "^" + i !== "/login" ? i.replace( /\.\*/g, "*" ).replace( /\*/g, ".*" ) : "$", "i" );
	} );

	if ( stateful ) {
		if ( config.auth.facebook.enabled ) {
			authMap.facebook_uri = "/auth/facebook";
			config.auth.protect.push( new RegExp( "^/auth/facebook" ) );
		}

		if ( config.auth.google.enabled ) {
			authMap.google_uri = "/auth/google";
			config.auth.protect.push( new RegExp( "^/auth/google" ) );
		}

		if ( config.auth.linkedin.enabled ) {
			authMap.linkedin_uri = "/auth/linkedin";
			config.auth.protect.push( new RegExp( "^/auth/linkedin" ) );
		}

		if ( config.auth.twitter.enabled ) {
			authMap.twitter_uri = "/auth/twitter";
			config.auth.protect.push( new RegExp( "^/auth/twitter" ) );
		}

		authUris = array.keys( authMap );
	}

	if ( stateful || config.security.csrf ) {
		sesh = {
			secret: config.session.secret || uuid(),
			saveUninitialized: true,
			rolling: true,
			resave: true
		};

		if ( config.session.store === "redis" ) {
			sesh.store = new RedisStore( config.session.redis );
		}

		fnCookie = cookie();
		fnSesh = session( sesh );

		obj.server.use( fnSesh ).blacklist( fnSesh );
		obj.server.use( fnCookie ).blacklist( fnCookie );

		if ( config.security.csrf ) {
			luscaCsrf = lusca.csrf( {key: config.security.key} );
			obj.server.use( luscaCsrf ).blacklist( luscaCsrf );
		}
	}

	if ( config.security.csp instanceof Object ) {
		luscaCsp = lusca.csp( config.security.csp );
		obj.server.use( luscaCsp ).blacklist( luscaCsp );
	}

	if ( !string.isEmpty( config.security.xframe ) ) {
		luscaXframe = lusca.xframe( config.security.xframe );
		obj.server.use( luscaXframe ).blacklist( luscaXframe );
	}

	if ( !string.isEmpty( config.security.p3p ) ) {
		luscaP3p = lusca.p3p( config.security.p3p );
		obj.server.use( luscaP3p ).blacklist( luscaP3p );
	}

	if ( config.security.hsts instanceof Object ) {
		luscaHsts = lusca.hsts( config.security.hsts );
		obj.server.use( luscaHsts ).blacklist( luscaHsts );
	}

	if ( config.security.xssProtection instanceof Object ) {
		luscaXssProtection = lusca.xssProtection( config.security.xssProtection );
		obj.server.use( luscaXssProtection ).blacklist( luscaXssProtection );
	}

	protection = zuul( config.auth.protect );
	obj.server.use( protection ).blacklist( protection );

	if ( stateless ) {
		passportInit = passport.initialize();
		obj.server.use( passportInit ).blacklist( passportInit );

		if ( config.auth.basic.enabled ) {
			(function () {
				var x = {};

				function validate ( arg, cb ) {
					if ( x[arg] ) {
						cb( null, x[arg] );
					}
					else {
						cb( new Error( "Unauthorized" ), null );
					}
				}

				array.each( config.auth.basic.list || [], function ( i ) {
					var args = i.split( ":" );

					if ( args.length > 0 ) {
						x[args[0]] = {password: args[1]};
					}
				} );

				passport.use( new BasicStrategy(
					function ( username, password, done ) {
						validate( username, function ( err, user ) {
							if ( err ) {
								// Removing the stack for a clean error message
								delete err.stack;
								return done( err );
							}

							if ( !user || user.password !== password ) {
								return done( null, false );
							}

							return done( null, user );
						} );
					}
				) );

				passportAuth = passport.authenticate( "basic", {session: false} );
				obj.server.use( passportAuth ).blacklist( passportAuth );
			})();
		}
		else if ( config.auth.bearer.enabled ) {
			( function () {
				var x = config.auth.bearer.tokens || [];

				function validate ( arg, cb ) {
					if ( array.contains( x, arg ) ) {
						cb( null, arg );
					}
					else {
						cb( new Error( "Unauthorized" ), null );
					}
				}

				passport.use( new BearerStrategy(
					function ( token, done ) {
						validate( token, function ( err, user ) {
							if ( err ) {
								// Removing the stack for a clean error message
								delete err.stack;
								return done( err );
							}

							if ( !user ) {
								return done( null, false );
							}

							return done( null, user, {scope: "read"} );
						} );
					}
				) );

				passportAuth = passport.authenticate( "bearer", {session: false} );
				obj.server.use( passportAuth ).blacklist( passportAuth );
			} )();
		}
	}
	else if ( stateful ) {
		if ( config.auth.local.enabled ) {
			obj.server.use( config.auth.local.middleware ).blacklist( config.auth.local.middleware );

			config.routes.get["/login"] = "POST credentials to authenticate";
			config.routes.get["/logout"] = function ( req, res ) {
				if ( req.session.authorized ) {
					req.session.destroy();
				}

				res.redirect( "/" );
			};
			config.routes.post = config.routes.post || {};
			config.routes.post["/login"] = function () {
				config.auth.local.auth.apply( obj, arguments );
			};
		}
		else if ( async ) {
			passportInit    = passport.initialize();
			passportSession = passport.session();

			obj.server.use( asyncFlag ).blacklist( asyncFlag );
			obj.server.use( passportInit ).blacklist( passportInit );
			obj.server.use( passportSession ).blacklist( passportSession );

			passport.serializeUser( function ( user, done ) {
				done( null, user );
			} );

			passport.deserializeUser( function ( obj, done ) {
				done( null, obj );
			} );

			if ( config.auth.facebook.enabled ) {
				passport.use( new FacebookStrategy( {
						clientID    : config.auth.facebook.client_id,
						clientSecret: config.auth.facebook.client_secret,
						callbackURL : realm + "/auth/facebook/callback"
					}, function ( accessToken, refreshToken, profile, done ) {
						config.auth.facebook.auth( accessToken, refreshToken, profile, function ( err, user ) {
							if ( err ) {
								return done( err );
							}

							done( null, user );
						} );
					}
				) );

				obj.server.get( "/auth/facebook", passport.authenticate( "facebook" ) );
				obj.server.get( "/auth/facebook/callback", passport.authenticate( "facebook", {failureRedirect: "/login"} ) );
				obj.server.get( "/auth/facebook/callback", redirect );
			}

			if ( config.auth.google.enabled ) {
				passport.use( new GoogleStrategy( {
						returnURL: realm + "/auth/google/callback",
						realm    : realm
					}, function ( identifier, profile, done ) {
						config.auth.google.auth.call( obj, identifier, profile, function ( err, user ) {
							if ( err ) {
								return done( err );
							}

							done( null, user );
						} );
					}
				) );

				obj.server.get( "/auth/google", passport.authenticate( "google" ) );
				obj.server.get( "/auth/google/callback", passport.authenticate( "google", {failureRedirect: "/login"} ) );
				obj.server.get( "/auth/google/callback", redirect );
			}

			if ( config.auth.linkedin.enabled ) {
				passport.use( new LinkedInStrategy( {
						consumerKey   : config.auth.linkedin.client_id,
						consumerSecret: config.auth.linkedin.client_secret,
						callbackURL   : realm + "/auth/linkedin/callback"
					},
					function ( token, tokenSecret, profile, done ) {
						config.auth.linkedin.auth( token, tokenSecret, profile, function ( err, user ) {
							if ( err ) {
								return done( err );
							}

							done( null, user );
						} );
					}
				) );

				obj.server.get( "/auth/linkedin", passport.authenticate( "linkedin" ) );
				obj.server.get( "/auth/linkedin/callback", passport.authenticate( "linkedin", {failureRedirect: "/login"} ) );
				obj.server.get( "/auth/linkedin/callback", redirect );
			}

			if ( config.auth.twitter.enabled ) {
				passport.use( new TwitterStrategy( {
						consumerKey   : config.auth.twitter.consumer_key,
						consumerSecret: config.auth.twitter.consumer_secret,
						callbackURL   : realm + "/auth/twitter/callback"
					}, function ( token, tokenSecret, profile, done ) {
						config.auth.twitter.auth( token, tokenSecret, profile, function ( err, user ) {
							if ( err ) {
								return done( err );
							}

							done( null, user );
						} );
					}
				) );

				obj.server.get( "/auth/twitter", passport.authenticate( "twitter" ) );
				obj.server.get( "/auth/twitter/callback", passport.authenticate( "twitter", {successRedirect: "/", failureRedirect: "/login"} ) );
			}

			if ( authUris.length > 0 ) {
				config.routes.get["/auth"] = authMap;

				( function () {
					var regex = "(?!/auth/(";

					array.each( authUris, function ( i ) {
						regex += i.replace( "_uri", "" ) + "|";
					} );

					regex = regex.replace( /\|$/, "" ) + ")).*$";

					obj.server.use( regex, guard ).blacklist( guard );
				} )();
			}

			config.routes.get["/login"] = {login_uri: "/auth"};
			config.routes.get["/logout"] = function ( req, res ) {
				if ( req.session.authorized || req.session.isAuthorized() ) {
					req.session.destroy();
				}

				res.redirect( "/" );
			};
		}
	}

	return config;
}
