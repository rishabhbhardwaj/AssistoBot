/*
 Assisto
 */

/* jshint node: true, devel: true */
'use strict';

var
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  async = require('async'),
  fs = require('fs'),
  request = require('request');

var app = express();

app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));



//Global

var dest;
var lat,long;
var dist, distmts;
var time, timesec;
var myMsg = "0";
var src="null";

var server = https.createServer({
      ca: fs.readFileSync('./ssl/chain.pem'),
      key: fs.readFileSync('./ssl/privkey.pem'),
      cert: fs.readFileSync('./ssl/cert.pem'),
      rejectUnauthorized: false
    }, app);

    // app.get('/', function (req, res) {
    //   res.header('Content-type', 'text/html');
    //   return res.end('<h1>Hello, Secure World!</h1>');
    // });

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
var APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
var VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
var PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 *
 */
app.post('/webhook', function (req, res) {

  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference#auth
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}


/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#received_message
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var messageId = message.mid;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;

  var msgArr = messageText.split(" ");
  dest = msgArr[msgArr.length - 1];
  console.log("Dest "+dest);
  if(msgArr.length > 2 && msgArr[0] == 'time' && msgArr[2] == 'travel') {

    if(msgArr[3] == "from")
      src=msgArr[4];

    myMsg="1";
    var info;
    var res;
    async.waterfall([
        function(callback){
          var options = {
                          url: 'https://www.googleapis.com/geolocation/v1/geolocate?key=AIzaSyACwIEG9X_kyq0ub9Sza2sNci24xR26qJs',
                          headers: {
                            'content-type': 'application/json'
                          },
                          method: 'POST'
                        };
          console.log("calling location");
          request(options, function(err, response, body) {
            // JSON body
            if(err) { console.log(err);callback(true); return; }
            info = JSON.parse(body);
            console.log("Location JSON"+ info);
            callback(null, info.location);
          });
        },
        function(location, callback){
          var myUrl = 'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=' + location.lat +',' + location.lng +'&destinations='+dest+'&key=AIzaSyDklmxFqTPRA-bVus-HcAmUUnMhtoGJtc8';
          if(src != "null") {
            myUrl = 'https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins='+ src +'&destinations='+dest+'&key=AIzaSyDklmxFqTPRA-bVus-HcAmUUnMhtoGJtc8';
          }
          var options = {
                          url: myUrl,
                          headers: {
                            'content-type': 'application/json'
                          },
                          method: 'GET'
                        };
          console.log(" lat "+location.lat+" long "+location.lng);

          lat = location.lat;
          long = location.lng;

          console.log("calling API for time");
          request(options, function(err, response, body) {
            // JSON body
            if(err) { console.log(err); callback(true); return; }
            res = JSON.parse(body);
            console.log("JSON response from time API"+JSON.stringify(res));
            time = res.rows[0].elements[0].duration.text;
            timesec = res.rows[0].elements[0].duration.value;
            dist = res.rows[0].elements[0].distance.text;
            distmts = res.rows[0].elements[0].distance.value;
            callback(null, time);
          });
        },
        function(time, callback){
          var tempMsg = 'Estimated Time to reach '+dest+' is '+time;
          if(src != "null") {
            tempMsg= 'Estimated Time to reach '+dest+' from '+ src +' is '+time;
            src="null";
          }
          sendTextMessage(senderID, tempMsg);
          callback(null);
        }
      ],
      function (err, result) {
       if(err) { console.log(err); res.send(500,"Server Error"); return; }
       console.log("Sending to Text Message "+senderID+dest+time);
       sendButtonTemplateYesorNo(senderID);
       //sendTextMessage(senderID, 'do you want the fare for the trip?');
      });
  }
    else {
      if (messageText) {

      // If we receive a text message, check to see if it matches any special
      // keywords and send back the corresponding example. Otherwise, just echo
      // the text we received.
      switch (messageText) {
        case 'image':
          sendImageMessage(senderID);
          break;

        case 'button':
          sendButtonMessage(senderID);
          break;

        case 'generic':
          sendGenericMessage(senderID);
          break;

        case 'receipt':
          sendReceiptMessage(senderID);
          break;

        default:
          sendTextMessage(senderID, messageText);
      }
    } else if (messageAttachments) {
      if(myMsg=="0")
      sendTextMessage(senderID, "Message with attachment received");
    }
  }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference#message_delivery
 *
 */

   function sendButtonTemplateYesorNo(recipientId){
     myMsg="1";
     var messageData = {
       recipient: {
         id: recipientId
       },
     "message":{
     "attachment":{
       "type":"template",
       "payload":{
         "template_type":"button",
         "text":"Do you want the estimate fare for the Uber trip to "+dest+"?",
         "buttons":[
           {
             "type":"postback",
             "payload":"USER_DEFINED_PAYLOAD_YES",
             "title":"Yes"
           },
           {
             "type":"postback",
             "title":"No",
             "payload":"USER_DEFINED_PAYLOAD_NO"
           }
         ]
       }
     }
   }
  };
  callSendAPI(messageData);
  }

  function sendButtonTemplateGO_X_XL(recipientId){
    myMsg="1";
    var PRICE_U_GO = Math.max((7 * Number(distmts))/1000 + (Number(timesec)/60) + 35, 50);
    var PRICE_U_X = Math.max((8 * Number(distmts))/1000 + (Number(timesec)/60) + 40, 75);
    var PRICE_U_XL = Math.max((17 * Number(distmts))/1000 + (Number(timesec)/60) + 80 , 80);
    console.log("Prices for Cabs "+ PRICE_U_GO +" "+PRICE_U_X +" "+PRICE_U_XL);
    var messageData = {
      recipient: {
        id: recipientId
      },
    "message":{
    "attachment":{
      "type":"template",
      "payload":{
        "template_type":"button",
        "text":"Select an Uber (Estimated Price) !!",
        "buttons":[
          {
            "type":"postback",
            "payload":"USER_DEFINED_PAYLOAD_GO",
            "title":"UberGO : Rs "+ PRICE_U_GO.toFixed(2)
          },
          {
            "type":"postback",
            "title":"UberX : Rs "+ PRICE_U_X.toFixed(2),
            "payload":"USER_DEFINED_PAYLOAD_X"
          },{
            "type":"postback",
            "payload":"USER_DEFINED_PAYLOAD_XL",
            "title":"UberXL : Rs"+ PRICE_U_XL.toFixed(2)
          }
        ]
      }
    }
  }
  };
  callSendAPI(messageData);
  }

function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. Read
 * more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#postback
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  if(payload == 'USER_DEFINED_PAYLOAD_YES'){
    sendButtonTemplateGO_X_XL(senderID);
  }
  else if(payload == 'USER_DEFINED_PAYLOAD_NO'){
    sendTextMessage(senderID,"Bye-Bye! :) (:");
  }
  else if(payload == 'USER_DEFINED_PAYLOAD_GO'){
    sendTextMessage(senderID,"Your UberGo has been booked!. Actually its not, I am still in development phase.");
  }
  else if(payload == 'USER_DEFINED_PAYLOAD_X'){
    sendTextMessage(senderID,"Your UberX has been booked!");
  }
  else if(payload == 'USER_DEFINED_PAYLOAD_XL'){
    sendTextMessage(senderID,"Your UberXL has been booked!");
  }
  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  //sendTextMessage(senderID, "Postback called");
}


/*
 * Send a message with an using the Send API.
 *
 */
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: "http://i.imgur.com/zYIlgBl.png"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Call Postback",
            payload: "Developer defined postback"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: "http://messengerdemo.parseapp.com/img/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: "http://messengerdemo.parseapp.com/img/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: "http://messengerdemo.parseapp.com/img/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: "http://messengerdemo.parseapp.com/img/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
server.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

