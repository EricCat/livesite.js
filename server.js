/*********************************************

FORTMAX Node.js SERVER

For more projects, visit https://github.com/fantachip/

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
**********************************************/

var http = require("http");
var https = require("https");
var fs = require("fs");
var url = require("url"); 
var path = require("path");
var JSON = require("JSON");
var walk = require("walk"); 
var mustache = require('mustache'); 
var crypto = require("crypto"); 
var querystring = require("querystring"); 
var formidable = require("formidable");
var mysql = require("mysql");
var async = require("async"); 
var multipart = require("multipart");
var sys = require("sys");
var config = {};

var server = {} ;

var widgets = {};
var pages = {};
var forms = {}; 
var texts = {}; 
var handlers = {};
var plugins = {}; 
var core = {}; 

var current_theme = {}; 


var mime_types = {
	'.html': "text/html",
	'.css':  "text/css",
	'.js':   "text/javascript",
	'.jpg': "image/jpeg",
	'.jpeg': "image/jpeg",
	'.png': "image/png"
};

var BASEDIR = __dirname+"/"; 
var ITEMS_PER_PAGE = 21; 

var sessions = {}; 
var theme = {};

var db = {} 
var vfs = require("./modules/vfs"); 
var loader = require("./modules/loader"); 

console.debug = function(msg){
	console.log("DEBUG: "+msg); 
}


function WidgetValue(widget, args, session){
	this.session = session; 
	this.widget = widget; 
	this.args = args; 
	
	var self = this; 
	
	return function(){
		return function(val){ // val is the argument from mustache
			var name = self.widget.id; 
			if(val){
				name = self.widget.id+"_"+val; 
			}
			console.log("Getting value for "+name+", "+val); 
			if(!(name in self.session.rendered_widgets)){
				var w = {};
				for(var key in self.widget)
					w[key] = self.widget[key];
				w.id = name; 
				w.argument = val; 
				widgets[name] = w; 
				console.log("Added copy widget for key "+name); 
				// call render for the widget
				//self.widget.render(docpath, self.args, self.session, function(html){
				//	session.rendered_widgets[name] = html; 
				//}); 
				return "Default Text"; 
			}
			return self.session.rendered_widgets[name];
		}
	};
}

server.SendEmail = function(rcpt_email, caption, template_name, data){
	var path         = require('path')
	, templatesDir   = path.resolve(__dirname, '..', 'templates')
	, emailTemplates = require('email-templates')
	, nodemailer     = require('nodemailer');
	
	emailTemplates(__dirname+"/email_templates", function(err, template) {
		if (err) {
			console.log(err);
			throw err; 
		} else {

			var transportBatch = nodemailer.createTransport("SMTP", {
				service: "Gmail",
				auth: {
					user: config.noreply_email,
					pass: config.noreply_pass
				}
			});
			
			// An example users object
			var rcpt = 
			[
				{
					email: rcpt_email,
					data: data
				}
			];

			var Render = function(data) {
				this.data = data;
				this.send = function(err, html, text) {
					if (err) {
						console.log(err);
					} else {
						transportBatch.sendMail({
							from: (config.noreply_from_name||"Default")+"<"+config.noreply_email+">",
							to: data.email,
							subject: caption,
							html: html,
							// generateTextFromHTML: true,
							text: text
						}, function(err, responseStatus) {
							if (err) {
								console.log(err);
							} else {
								console.log(responseStatus.message);
							}
						});
					}
				};
				this.batch = function(batch) {
					try{
						batch(this.data, "email_templates", this.send);
					} catch(e){
						console.log("ERROR WHILE SENDING EMAILS: "+e); 
					}
				};
			};

			// Load the template and send the emails
				template(template_name, true, function(err, batch) {
					for(var rc in rcpt) {
						var render = new Render(rcpt[rc]);
						render.batch(batch);
					}
				});
		}
	});
}
var User = function(){
	this.loggedin = false; 
	this.username = "default";
}

var Session = function(){
	this.sid = String(crypto.createHash("sha1").update(String(Math.random())).digest("hex")); 
	this.user = new User(); 
	this.rendered_widgets = {}; 
}

Session.prototype.render = function(template, args){
	var session = this; 
	var params = {};
	// add all value retreivers for all currently available widgets
	for(var key in widgets){
		params[key] = new WidgetValue(widgets[key], args, session); 
	}
	// add args to the options array
	for(var key in args){
		params[key] = args[key]; 
	}
	if(!(template in forms)){
		return "Form "+template+".html does not exist!";
	} else {
		return mustache.render(forms[template], params);
	} 
}

Session.prototype.render_widgets = function(widgets, path, args, callback){
	var self = this; 
	var data = {}; 
	async.eachSeries(Object.keys(widgets), function(k, cb){
		if(widgets[k]){
			widgets[k].render(path, args, self, function(x){
				data[k] = x; 
				cb(); 
			});
		} else {
			console.debug("Error: empty widget found in argument for key "+k); 
			cb(); 
		}
	}, function(){
		if(callback) callback(data); 
	});
}

Session.prototype.toJSON = function(){
	return {
		sid: this.sid, 
		user: this.user
	}
}
			
function getOrCreateSession(sid){
	var cookies = {};
	var session = {}; 
	
	function setSessionTimeout(session){
		if("timeout" in session)
			clearTimeout(session.timeout); 
		session.timeout = setTimeout(function(){
			console.debug("Removing session object for "+session.sid); 
			delete sessions[session.sid];
		}, 60000*20); 
	}; 
		
	console.log("Looking up session "+sid+"..."); 
	
	if(!sid || sid == "" || !(sid in sessions)){
		// generate new session
		session = new Session(); 
		// init all plugins
		for(var key in plugins){
			if("initSession" in plugins[key]){
				plugins[key].initSession(session); 
			}
		}
		setSessionTimeout(session); 
		sessions[session.sid] = session; 
		console.debug("Creating new session: "+session.sid); 
	} else {
		session = sessions[sid]; 
		setSessionTimeout(session); 
		console.debug("Returning existing session: "+session.sid); 
	}
	return session; 
}

function parseCookieString(str){
	var cookies = {}; 
	str && str.split(';').forEach(function( cookie ) {
		var parts = cookie.split('=');
		cookies[ parts[ 0 ].trim() ] = ( parts[ 1 ] || '' ).trim();
	});
	return cookies; 
}

function CreateServer(){
	http.createServer(function(req, res){
		try {
			console.log("============== SERVING NEW REQUEST ==============="); 
			var cookies = parseCookieString(req.headers.cookie); 
			var session = getOrCreateSession(cookies["session"]); 
			
			var query = url.parse(req.url, true);
			var docpath = query.pathname;
			var cleanpath = docpath.replace(/\/+$/, "").replace(/^\/+/, ""); 
							
			var args = {}
			Object.keys(query.query).map(function(k){args[k] = query.query[k];}); 
			
			var handler = current_theme; 
			// use plugin registered handler if anyone wants to do the rendering
			if(docpath in pages && pages[docpath].handler in handlers){
				console.debug("Will use special handler for page "+docpath); 
				handler = handlers[pages[docpath].handler];
			}
			
			// auto login
			if(!session.user.loggedin && server.config.auto_login){
				session.user = {
					username: "admin",
					role: "admin",
					loggedin: true
				}
			}
			
			var headers = {
				"Content-type": "text/plain"
			}; 
			headers["Set-Cookie"] = "session="+session.sid+"; path=/";
		
			function serveFile(res, filepath){
				fs.readFile(filepath, "binary", function(err, data){
					if(err) {
						res.end(); 
						return; 
					}
					
					var headers = {}; 
					
					headers["Content-type"] = mime_types[path.extname(docpath)]; 
					headers["Cache-Control"] = "public max-age=120";
					
					res.writeHead(200, headers);
					res.write(data, "binary"); 
					res.end(); 
				});
			}
			
			function renderWidgets(args, dst, callback){
				callback(); 
				return; 
				async.eachSeries(Object.keys(widgets), function(i, callback){
					console.log("Prerendering widget "+i); 
					var new_args = {};
					Object.keys(args).map(function(x){new_args[x] = args[x];}); 
					new_args["widget_id"] = widgets[i].id; 
					new_args["widget_arg"] = widgets[i].argument; 
					widgets[i].render(docpath, new_args, session, function(html){
						dst[i] = html;
						callback();
					}); 
				}, function(){
					callback(); 
				}); 
			}
			function serveGET(){
				var filepath = vfs.resolve(docpath); 
				
				console.debug("GET "+docpath);
				
				if(filepath){
					console.debug("Will serve file "+filepath); 
					serveFile(res, filepath); 
				} else {
					console.debug("Will serve PAGE "+docpath); 
					
					headers["Content-type"] = "text/html; charset=utf-8"; 
					headers["Cache-Control"] = "public max-age=120";
					
					if(!handler) {
						res.writeHead(404, headers); 
						res.write("Path not found!"); 
						res.end(); 
						return; 
					}
					
					if("headers" in handler){
						for(var key in handler.headers){
							headers[key] = handler.headers[key];
						} 
					}
					
					// do the render, either though theme or plugin
					if("render" in handler || "get" in handler){
						(handler["render"] || handler["get"]).call(handler, cleanpath, args, session,
							function(html){
								res.writeHead(200, headers); 
								res.write(html); 
								res.end(); 
						});
					} else {
						console.debug("Could not find render method in handler "+JSON.stringify(Object.keys(handler))); 
						res.writeHead(404, headers); 
						res.write("Page was not found on this server!"); 
						res.end(); 
					}
				}
			}
			function servePOST(){
				var form = new formidable.IncomingForm();
				form.parse(req, function(err, fields, files) {
					console.debug("FORM: "+docpath+" > "+JSON.stringify(fields)+" > "+JSON.stringify(files)); 
					
					// TODO: do we need to update the signature of all handlers to accomodate for uploaded files or is this ok?
					if(Object.keys(files).length)
						args["uploaded_file"] = files["file"]; 
						
					Object.keys(fields).map(function(k){args[k] = fields[k]; }); 
					
					if(args["rcpt"] && args["rcpt"] in plugins && "post" in plugins[args["rcpt"]]){
						var plug = plugins[args["rcpt"]]; 

						plug.post(cleanpath, args, session, function(response){
							headers["Content-type"] = "text/html; charset=utf-8"; 
							// optional global redirect option
							if("redirect" in args){
								headers["Location"] = args["redirect"]; 
								res.writeHead(301, headers); 
							} else {
								res.writeHead(200, headers); 
							}
							if(response) res.write(response); 
							res.end(); 
						});  
					} else if("rcpt" in args && (args["rcpt"] == "livesite" || args["rcpt"] == "core")){
						// stuff that is submitted directly to the server
						if("contact_info" in args){
							var caption = args["email_caption"]||"New customer information!"; 
							var email = args["target_email"]||config.admin_email; 
							server.SendEmail(email, caption, "contact_form_notification", args); 
						}
						headers["Content-type"] = "text/html; charset=utf-8"; 
						// optional global redirect option
						if("redirect" in args){
							headers["Location"] = args["redirect_href"]||docpath; 
							res.writeHead(301, headers); 
						} else {
							res.writeHead(200, headers); 
						}
						res.write("Done!"); 
						res.end(); 
					} else if("post" in handler){
						handler.post(cleanpath, args, session, function(response){
							headers["Content-type"] = "text/html; charset=utf-8"; 
							res.writeHead(200, headers); 
							if(response) res.write(response); 
							res.end(); 
						}); 
					} else {
						res.writeHead(404, headers); 
						res.write("This page does not accept any post data!"); 
						res.end(); 
					}
				});
			}
			// upon a post request we simply process the post data 
			// and redirect the user to the same page. 
			if(req.method == "POST"){
				servePOST(); 
			} else if(req.method == "GET"){
				serveGET(); 
			} else {
				res.writeHead(504, headers); 
				res.write("Server does not recognize this request method "+req.method); 
				res.end(); 
			}
		} catch(e) { // prevent server crash
			console.debug("FATAL ERROR WHEN SERVING CLIENT "+path+", session: "+JSON.stringify(session)+": "+e+"\n"+e.stack); 
			res.writeHead(200, {}); 
			res.write("Fatal server error occured. Please go to home page."); 
			res.end(); 
		}
	}).listen(config.server_port);
}

exports.init = function(cfg, callback){
	config = cfg; 
	if(!("site_path" in config)) config.site_path = process.cwd(); 
	db = require("./modules/db").connect(config.database, callback);
}

exports.boot = function(site){
	var loader = require("./modules/loader"); 
	server.db = db; 
	server.pages = db.pages; 
	server.config = config;
	server.basedir = BASEDIR; 
	server.widgets = widgets; 
	server.vfs = vfs; 
	server.users = db.users; 
	server.properties = db.properties; 
	server.theme = {}; 
	
	server.handlers = {
		register: function(class_name, module){
			if(class_name in handlers){
				console.log("WARNING: Replacing handler for "+class_name); 
			}
			//handlers[class_name] = module; 
			console.log("Registered handler for "+class_name); 
		}
	}
	
	server.get_widget_or_empty = function(name){
		if(!(name in widgets)){
			return {
				new: function(){console.log("Error creating instance of "+name+": New can not be called on default widget! Fix your code!");},
				init: function(){},
				render: function(a, b, c, d){d("Default widget!");},
				data: function(data){return this;}
			}
		} 
		return widgets[name]; 
	}
	
	server.get_widget = function(name){
		return widgets[name]||null; 
	}
	
	async.series([
		function(cb){
			loader.LoadModule(__dirname, function(module){
				if(!module){
					console.debug("Could not load core components!"); 
					process.exit(); 
				}
				core = module; 
				for(var key in module.forms) forms[key] = module.forms[key]; 
				for(var key in module.handlers){
					handlers[key] = module.handlers[key]; 
					handlers[key].init(server); 
					var hr = handlers[key]; 
					if("pages" in hr) {
						for(var h in hr.pages){
							console.debug("Setting page handler for "+hr.pages[h]+" to "+hr.name); 
							pages[hr.pages[h]] = {
								handler: hr.name
							}
						}
					}
				}
				for(var key in module.widgets) {
					widgets[key] = module.widgets[key]; 
					widgets[key].init(server); 
				}
				cb(); 
			});
		}, 
		function(callback){
			console.debug("Indexing module content in "+__dirname+"/content"); 
			vfs.add_index(__dirname+"/content", function(){
				callback(); 
			}); 
		},
		function(callback){
			console.debug("Loading plugins.."); 
			var directory = __dirname+"/plugins"; 
			console.debug("Loading plugins from "+directory); 
			fs.readdir(directory, function(err, files) {
				var pl = []; 
				async.each(files, function(file, next){
					fs.stat(directory + '/' + file, function(err, stats) {
						console.log(JSON.stringify(stats)+" "+stats.isDirectory()); 
						if(stats.isDirectory()) {
							pl.push(file); 
						}
						next(); 
					});
				}, loadplugins); 
				function loadplugins(){
					async.eachSeries(pl, function(plug, cb){
						console.debug("Loading plugin "+plug); 
						loader.LoadModule(directory+"/"+plug, function(module){
							if(module){
								// for plugins we must prefix all resources with plugin name and underscore
								vfs.add_index(directory+"/"+plug+"/content", function(){
									cb(); 
								}); 
								module.init(server); 
								for(var key in module.forms) forms[plug+"_"+key] = module.forms[key]; 
								for(var key in module.handlers) {
									module.handlers[key].init(server); 
									handlers[key] = module.handlers[key]; 
								}
								for(var key in module.widgets) {
									module.widgets[key].init(server); 
									widgets[plug+"_"+key] = module.widgets[key]; 
								}
								plugins[plug] = module; 
							} else {
								cb(); 
							}
						}); 
					}, function(){
						callback(); 
					}); 
				}
			});
		},
		function(cb){
			console.debug("Loading site data..."); 
			if(!fs.existsSync(config.site_path)){
				console.debug("Directory "+config.site_path+" not found!"); 
				cb(); 
			} else {
				loader.LoadModule(config.site_path, function(module){
					if(module){
						current_theme = site; 
						server.vfs.add_index(config.site_path+"/content"); 
						for(var key in module.forms) forms[key] = module.forms[key]; 
						for(var key in module.handlers){
							handlers[key] = module.handlers[key]; 
							handlers[key].init(server); 
						}
						for(var key in module.widgets) {
							widgets[key] = module.widgets[key]; 
							widgets[key].init(server); 
						}
						
						current_theme.init(server); 
					}
					cb(); 
				}); 
			}
		}
	], function(){
		
		CreateServer(); 
		console.log("Server listening...");
	}); 
	
}

