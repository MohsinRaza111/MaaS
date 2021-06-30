var GtfsRealtimeBindings = require('gtfs-realtime-bindings');
var request = require('request');
var express = require('express');
var app = express();
var protobuf = require('protobufjs');
var fs = require('fs');
var unzip = require('unzip-stream');
var mysql = require('mysql');
var cors = require('cors');
var schedule = require('node-schedule');                        // Schedule the 2am download of GTFS data
var csv = require('fast-csv');                                  // Needed to parse th CSV document
var opn = require('open');
var port = process.env.PORT || 80;                            // Start on port 3000
var path = require('path');
var bodyParser = require('body-parser'); 


/* SERVER REQUEST MIDDLEWARE & INITIALISATION */
function requestExtension(req, res, next){
    blue(new Date(Date.now()).toLocaleString()+" : IP "+req.ip+" requested "+req.originalUrl);  // Every request can be printed in blue to the console
    next(); 
}
app.use(cors()); // Use the cross-site origin request to prevent HTTPS errors
app.use(requestExtension);
var server = app.listen(port, function(){
    log('Service started at http://' + server.address().address + ":" + server.address().port); // Log the address to access the backend
});

var api = express.Router();
var page = express.Router();
app.use("/api", api);
app.use("/", express.static(path.join(__dirname, 'public')));


var requestSettings = {
  method: 'GET',
  url: '',
  encoding: null,
  headers: {
    'Accept': 'application/json',
    'Authorization': 'apikey f3g9H11o8yxTrUq4ub8ylTqDJuE0D4teoZkR'
    }
};
var feeds = [
    {
        id: 'RealtimeVehiclePosition',
        name: 'Realtime Vehicle Positions',
        url: 'https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/sydneytrains',
        method: 'GET'
    },
    {
        id: 'RealtimeTripUpdates',
        name: 'Realtime Trip Updates',
        url: 'https://api.transport.nsw.gov.au/v1/gtfs/realtime/sydneytrains',
        method: 'GET'
    },
    {
        id: 'RealtimeAlerts',
        name: 'Realtime Alerts',
        url: 'https://api.transport.nsw.gov.au/v1/gtfs/alerts/sydneytrains',
        method: 'GET'
    },
    {
        id: 'TimetablesCompleteGTFS',
        name: 'Sydney Trains GTFS Timetables',
        url: 'https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains',
        method: 'GET',
        outputFile: 'sydneytrains.zip'
    }
];
var files = [
    {
        name: 'agency',
        filename: 'agency.txt',
    },
    {
        name: 'calendar',
        filename: 'calendar.txt',
    },
    {
        name: 'routes',
        filename: 'routes.txt',
    },
    {
        name: 'shapes',
        filename: 'shapes.txt',
    },
    {
        name: 'stop_times',
        filename: 'stop_times.txt',
    },
    {
        name: 'stops',
        filename: 'stops.txt',
    },
    {
        name: 'trips',
        filename: 'trips.txt',
    }
];
var databaseConfiguration = {
    host: "localhost",
    user: "root",
    password: "",
    database: "990project",
    multipleStatements: true
};
var con;
var feedStatus = ["OK", "OK", "OK", "OK"];



startMySQL();
requestGTFSFeed(0);
requestGTFSFeed(1);
requestGTFSFeed(2);
//requestGTFSFeed(3);
/* SCHEDULED JOBS TO COMPLETE AFTER START */
schedule.scheduleJob({hour:02, minute:00}, function(){
    requestGTFSFeed(3);
});                // Update ZIP every day at 2am
setInterval(requestGTFSFeed, 15000, 0);                                       // Realtime Vehicle Positions (updates every 15 sec)
setInterval(requestGTFSFeed, 30000, 1);                                       // Realtime Trip Updates (updates every 30 sec)
setInterval(requestGTFSFeed, 600000, 2);                                      // Realtime Service Alerts (updates every 10 min)


count = con.query("SELECT COUNT(*) FROM delays", function(err, result){
    log(JSON.stringify(result))
})
count = con.query("SELECT COUNT(*) FROM stop_update", function(err, result){
    log(JSON.stringify(result))
})
count = con.query("SELECT COUNT(*) FROM vehicleinfo", function(err, result){
    log(JSON.stringify(result))
})
count = con.query("SELECT COUNT(*) FROM trainposition", function(err, result){
    log(JSON.stringify(result))
})


function requestGTFSFeed(type){
    requestSettings.url = feeds[type].url;
    request(requestSettings, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (type == 3) {
                var feed = body;
            }
            else{
                var feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(body);
             /*    console.log("Mohsin 2222");
				feed.entity.forEach(function(entity) {
					if (entity.tripUpdate) {
					console.log(entity.tripUpdate);
							}
			}); */
			}
			
			
            parseGTFSFeed(type, feed);
			
        }else{
            updateFeedStatus(type, "There was a problem retrieving "+feeds[type].name);
        }
    });
}
function parseGTFSFeed(type, feed){
 
    switch(type){
        case 0: 
             var vehicleArray = [];
            var vehiclePosArray = [];

            for(x in feed.entity){
                vehicleArray.push([
                    getCurrentDate(),
                    feed.entity[x].vehicle.trip.tripId,
                    feed.entity[x].vehicle.trip.scheduleRelationship,
                    feed.entity[x].vehicle.trip.routeId,
                    feed.entity[x].vehicle.congestionLevel,
                    feed.entity[x].vehicle.vehicle.id,
                    feed.entity[x].vehicle.vehicle.label //some of the entities don't have labels
                ]);

                var longitude = "";
                var latitude = "";
                if(feed.entity[x].vehicle.position == null || feed.entity[x].vehicle.position.longitude == null || feed.entity[x].vehicle.position.latitude == null){
                    longitude = "";
                    latitude = "";
                }else{
                    longitude = feed.entity[x].vehicle.position.longitude;
                    latitude = feed.entity[x].vehicle.position.latitude;
                }
                vehiclePosArray.push([
                    feed.entity[x].vehicle.trip.tripId,
                    longitude,
                    latitude,
                    feed.entity[x].vehicle.stopId,
                    feed.entity[x].vehicle.timestamp.low // what are low high and unsigned ?
                ])
            }
            con.query("INSERT INTO `990project`.`vehicleinfo` VALUES ? ON DUPLICATE KEY UPDATE congestionLevel = VALUES(congestionLevel), vehicleLabel = VALUES(vehicleLabel);", [vehicleArray], function(err, result){
                if(err){
                    log("Insert VehiclePosInfo Error: "+err);
                    return;
                }

                con.query("INSERT INTO `990project`.`trainposition` VALUES ? ON DUPLICATE KEY UPDATE longitude = VALUES(longitude), latitude = VALUES(latitude);", [vehiclePosArray], function(err, result){
                    if(err){
                        log("Insert TrainPosition Error: "+err);
                        return;
                    }
                    updateFeedStatus(type, "OK");
                });

            });
            break;
        // trip update
        case 1:
            var stationTimes = [];
            for(x in feed.entity){
                var id = feed.entity[x].id;
                var trainScheduleRelationship = feed.entity[x].tripUpdate.trip.scheduleRelationship;

                for(y in feed.entity[x].tripUpdate.stopTimeUpdate){
                    var arrivalTime = 0;
                    var arrivalDelay = 0;
                    var departureTime = 0;
                    var departureDelay = 0;
                    var stop_id;
                    var stopScheduleRelationship = 0;

                    if(feed.entity[x].tripUpdate.stopTimeUpdate[y].arrival){
                        arrivalTime = feed.entity[x].tripUpdate.stopTimeUpdate[y].arrival.time + 0;          // So we don't get a null error
                        arrivalDelay = feed.entity[x].tripUpdate.stopTimeUpdate[y].arrival.delay + 0;        // So we don't get a null error
                    }
                    if(feed.entity[x].tripUpdate.stopTimeUpdate[y].departure){
                        departureTime = feed.entity[x].tripUpdate.stopTimeUpdate[y].departure.time + 0;      // So we don't get null error
                        departureDelay = feed.entity[x].tripUpdate.stopTimeUpdate[y].departure.delay + 0;    // So we don't get a null error
                    }
                    if(feed.entity[x].tripUpdate.stopTimeUpdate[y].scheduleRelationship){
                        stopScheduleRelationship = feed.entity[x].tripUpdate.stopTimeUpdate[y].scheduleRelationship + 0;
                    }

                    stopId = feed.entity[x].tripUpdate.stopTimeUpdate[y].stopId;
                    stationTimes.push([
                        id,
                        arrivalTime,
                        arrivalDelay,
                        departureTime,
                        departureDelay,
                        stopId,
                        stopScheduleRelationship,
                        trainScheduleRelationship
                    ]);


                }

            }
            //con.query("INSERT INTO `990project`.`stop_update` (arrivalTime, arrivalDelay, departureTime, departureDelay, trainScheduleRelationship,stopScheduleRelationship) VALUES (arrivalTime, arrivalDelay, departureTime, departureDelay, trainScheduleRelationship,stopScheduleRelationship);", [stationTimes], function(err, result){
        
			con.query("INSERT INTO `990project`.`stop_update` VALUES ? ON DUPLICATE KEY UPDATE arrivalTime = VALUES(arrivalTime), arrivalDelay = VALUES(arrivalDelay), departureTime = VALUES(departureTime), departureDelay = VALUES(departureDelay), trainScheduleRelationship = VALUES(trainScheduleRelationship), stopScheduleRelationship = VALUES(stopScheduleRelationship);", [stationTimes], function(err, result){
			       if(err){
                    log("Insert stop_update Error: "+err);
                    return;
                }
                updateFeedStatus(type, "OK");
            });
            break;
        // alerts
        case 2:

            var delays = [];
            for(delay in feed.entity){
                var delayType;
                var delayedEntity = "";
                var delayDescription = "";
                var delayHeader = "";
                var delayCause = "";
                var delayEffect = "";

                for(entity in feed.entity[delay].alert.informedEntity){

                    if(feed.entity[delay].alert.informedEntity[entity].stopId){
                        delayType = 0;
                        delayedEntity = feed.entity[delay].alert.informedEntity[entity].stopId;
                    }else if(feed.entity[delay].alert.informedEntity[entity].trip){
                        delayType = 1;
                        delayedEntity = feed.entity[delay].alert.informedEntity[entity].trip.tripId;
                    }else{
                        delayType = 2;
                        delayedEntity = feed.entity[delay].alert.informedEntity[entity].routeId;
                    }

                    if(feed.entity[delay].alert.descriptionText == null || feed.entity[delay].alert.descriptionText.translation[0].text == null){
                        delayDescription = "";
                    }else{
                        delayDescription = feed.entity[delay].alert.descriptionText.translation[0].text;
                    }
                    delayHeader = feed.entity[delay].alert.headerText.translation[0].text;
                    delayCause = feed.entity[delay].alert.cause;
                    delayEffect = feed.entity[delay].alert.effect;

                    delays.push([
                        null,
                        delayType,
                        delayedEntity,
                        delayHeader,
                        delayDescription,
                        delayCause,
                        delayEffect
                    ]);

                }
            }
            con.query("INSERT INTO `990project`.`delays` VALUES ? ON DUPLICATE KEY UPDATE delayType = VALUES(delayType), delayedEntity = VALUES(delayedEntity), delayHeader = VALUES(delayHeader), delayDescription = VALUES(delayDescription), delayCause = VALUES(delayCause), delayEffect = VALUES(delayEffect);", [delays], function(err, result){
                if(err){
                    log("Insert Delays Error: "+err);
                    return;
                }
                updateFeedStatus(type, "OK");
            });
            break;
        // static schedule tables
        case 3:
            fs.writeFile(feeds[type].outputFile, feed, function(err) {
                if(err){
                    log("Couldn't save the GTFS ZIP File");
                    return;
                }
                fs.createReadStream(feeds[type].outputFile).pipe(unzip.Extract({ path: feeds[type].id }))
                    .on('close', function (close) {
                    log("The ZIP file is downloaded & extracted successfully");
                    parseCSVtoDatabaseTables(type);
                });
                log("The ZIP file is loaded to database successfully");
            });
            break;
        default:
            log("There was a problem. The parse case was not in range (0-3)");
    }
}

function parseCSVtoDatabaseTables(type){
    for(var i=0;i<files.length;i++){
        con.query("DELETE FROM "+files[i].name, function(err, result){
            if(err){
                log("Couldn't clean the database");
                return;
            }
        })
        con.query("LOAD DATA LOCAL INFILE './TimetablesCompleteGTFS/"+files[i].filename+"' INTO TABLE 990project."+files[i].name+" FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\r\n' IGNORE 1 LINES", function(err, result){
            if(err){
                log("Couldn't read the CSV file to the database");
                return;
            }
            log("Updated tables in the database. Num of Changed Rows: "+result.affectedRows);
        })
    }
    updateFeedStatus(type, "OK");
}


function startMySQL() {
    con = mysql.createConnection(databaseConfiguration);
    con.connect(function(err) {
        if(err) {
            console.log('Error connecting to the database:', err);
            setTimeout(startMySQL, 10000);
        }else{
            console.log("Database is connected");
            con.on('error', function(err) {
                if(err.code === 'PROTOCOL_CONNECTION_LOST'){
                    startMySQL();
                }else{
                    log("The database has lost connection... will attempt to reconnect shortly");
                }
            })
        }
    });
}

/* Generic Calls */
api.get("/ping/", function (req, res){ 
    for(var x=0;x<4;x++){
        if(feedStatus[x] != "OK"){
            res.end(JSON.stringify({result:"Error: "+feedStatus[x]}));
            return;
        }
    }
    res.end(JSON.stringify({result:"LIVE"}));
})              // Returns LIVE when all feedStatus are "OK", or the first error message in feedStatus
api.get("/test/", function(req, res){
    con.query("SHOW TABLES", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
}) 

api.get("/getRoutes/", function(req, res){
    con.query("SELECT DISTINCT agency_name, routes.route_long_name FROM `990project`.`agency` JOIN routes ON routes.agency_id = agency.agency_id ORDER BY agency_name, routes.route_long_name;", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})          // Returns agency names & distinct route names from the database

api.get("/agencies/", function(req, res){
    con.query("SELECT * FROM `990project`.`agency`", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})           // (NOT IMPLEMENTED - NO NEED) Returns all agency data

api.get("/stations/", function(req, res){
    con.query("SELECT * FROM `990project`.`stops` WHERE LOCATION_TYPE = 1", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})           // Returns all data of stations ONLY

api.get("/platforms/", function(req, res){
    con.query("SELECT * FROM `990project`.`stops` WHERE LOCATION_TYPE = 0", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})          // Returns all data of platforms ONLY

api.get("/runNumbers/", function(req, res){
    con.query("SELECT DISTINCT LEFT(tripID,LOCATE('.',tripID) - 1) AS DATA FROM trainposition", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})         // Returns all Run Numbers that have appeared in when logging train positions

api.get("/currentTrains/", function(req, res){
    con.query("SELECT trainposition.timestamp, trainposition.longitude, trainposition.latitude, trainposition.tripid, (SELECT routes.route_long_name FROM routes WHERE routes.route_id = vehicleinfo.routeID) AS routeName, vehicleinfo.vehicleID, vehicleinfo.vehicleLabel FROM trainposition JOIN (SELECT tripID, MAX(TIMESTAMP) as TIMESTAMP FROM trainposition WHERE TIMESTAMP > (UNIX_TIMESTAMP()-180) GROUP BY tripID) a ON trainposition.tripid = a.tripid AND trainposition.timestamp = a.timestamp JOIN vehicleinfo ON trainposition.tripid = vehicleinfo.tripID", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})      // Returns the vehicle position & details of trains that have been updated in the last 3 minutes

api.get("/shapes/", function(req, res){
    con.query("SELECT shapes.shape_id as id, shapes.shape_pt_lat as lat, shapes.shape_pt_lon as lon, routes.route_color as colour FROM `shapes` JOIN ROUTES on shapes.shape_id = routes.route_id", function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})             // Returns shapes, colours & position of train routes on the network

/* Current Network Performance Requests */
api.get("/getWeeksArrivalDelaySecondsForAllRoutes/", function(req, res){     
   var query = "SELECT DATE(vehicleinfo.foundTimestamp) as date, IFNULL(sum(arrivalDelay),0) as seconds, IFNULL(sum(1), 0) as numberDelayed FROM stop_update JOIN vehicleinfo ON stop_update.tripID = vehicleinfo.tripID WHERE DATE(vehicleinfo.foundTimestamp) BETWEEN SUBDATE(CURDATE(), INTERVAL 7 DAY) AND CURDATE() AND arrivalDelay > 0 GROUP BY DATE(vehicleinfo.foundTimestamp)";
  
    
    var query = con.query(query, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
});     // Returns the date, total number of seconds delayed, and total number of trains delayed for last 7 days for all Routes

api.get("/getWeeksArrivalDelaySeconds/:routeName/:dateFrom/:dateTo", function(req, res){
    var routeName = req.params.routeName, dateFrom = req.params.dateFrom, dateTo = req.params.dateTo, query, queryVars = [];
    if(routeName != "" && routeName.toLowerCase() != "all" && Date.parse(dateFrom) && Date.parse(dateTo)){
        queryVars.push(dateFrom, dateTo, routeName);
        query = "SELECT DATE(vehicleinfo.foundTimestamp) as Date, IFNULL(sum(arrivalDelay),0) as seconds, IFNULL(sum(1), 0) as numberDelayed FROM stop_update JOIN vehicleinfo ON stop_update.tripID = vehicleinfo.tripID WHERE foundTimestamp BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) AND arrivalDelay > 0 AND vehicleinfo.routeId IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?) GROUP BY DATE(vehicleinfo.foundTimestamp)";
    }else if(routeName != "" && routeName.toLowerCase() != "all"){
        queryVars.push(routeName)
        query = "SELECT DATE(vehicleinfo.foundTimestamp) as date, IFNULL(sum(arrivalDelay),0) as seconds, IFNULL(sum(1), 0) as numberDelayed FROM stop_update JOIN vehicleinfo ON stop_update.tripID = vehicleinfo.tripID WHERE DATE(vehicleinfo.foundTimestamp) BETWEEN SUBDATE(CURDATE(),14) AND CURDATE() AND arrivalDelay > 0 AND vehicleinfo.routeId IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?) GROUP BY DATE(vehicleinfo.foundTimestamp)";
    }else{
        query = "SELECT DATE(vehicleinfo.foundTimestamp) as date, IFNULL(sum(arrivalDelay),0) as seconds, IFNULL(sum(1), 0) as numberDelayed FROM stop_update JOIN vehicleinfo ON stop_update.tripID = vehicleinfo.tripID WHERE DATE(vehicleinfo.foundTimestamp) BETWEEN SUBDATE(CURDATE(),14) AND CURDATE() AND arrivalDelay > 0 GROUP BY DATE(vehicleinfo.foundTimestamp)";
    }
    
    var query = con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
});     // Returns the date, total number of seconds delayed, and total number of trains delayed for last 7 days for given inputs

api.get("/hourlyDelayedDepartures/:routeName", function(req, res){
    var routeName = req.params.routeName, query, queryVars = [];
    if(routeName == "" || routeName.toLowerCase() == "all"){
        query = "SELECT CONCAT( DATE_FORMAT( stop_times.departure_time, '%h:00 %p' ), \" - \", DATE_FORMAT( DATE_ADD( stop_times.departure_time, INTERVAL 1 HOUR ), '%h:00 %p' ) ) as time, IFNULL( sum( CASE when departureDelay > 180 then 1 else 0 end ), 0 ) as numberDelayed FROM stop_update JOIN stop_times ON stop_update.tripID = stop_times.trip_id AND stop_update.stopID = stop_times.stop_id WHERE TRIPID IN ( SELECT TRIPID FROM vehicleinfo WHERE vehicleinfo.foundTimestamp = CURDATE() ) AND HOUR(stop_times.departure_time) BETWEEN HOUR( DATE_SUB(NOW(), INTERVAL 5 HOUR) ) AND HOUR(NOW()) GROUP BY HOUR(stop_times.departure_time)";
    }else{
        queryVars.push(routeName);
        query = "SELECT CONCAT(DATE_FORMAT(stop_times.departure_time, '%h:00 %p'), \" - \", DATE_FORMAT(DATE_ADD(stop_times.departure_time, INTERVAL 1 HOUR), '%h:00 %p')) as time, IFNULL(sum(CASE when departureDelay > 180 then 1 else 0 end), 0) as numberDelayed FROM stop_update JOIN stop_times ON stop_update.tripID = stop_times.trip_id AND stop_update.stopID = stop_times.stop_id WHERE TRIPID IN (SELECT TRIPID FROM vehicleinfo WHERE vehicleinfo.foundTimestamp = CURDATE() AND ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?)) AND HOUR(stop_times.departure_time) BETWEEN HOUR(DATE_SUB(NOW(), INTERVAL 5 HOUR)) AND HOUR(NOW()) GROUP BY HOUR(stop_times.departure_time)";
    }
    
    var query = con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})                            // Returns the time period & number of late station departures for the last 6 hours according to route


api.get("/hourlyTrainsLosingGainingGround/:routeName", function(req, res){
    var routeName = req.params.routeName, query, queryVars = [];
    if(routeName == "" || routeName.toLowerCase() == "all"){
        query = "SELECT CONCAT(DATE_FORMAT(stop_times.arrival_time, '%h:00 %p'), \" - \", DATE_FORMAT(DATE_ADD(stop_times.arrival_time, INTERVAL 1 HOUR), '%h:00 %p')) as time, (IFNULL(sum(CASE when arrivalDelay > 180 then 1 else 0 end), 0)-IFNULL(sum(CASE when departureDelay > 180 then 1 else 0 end), 0)) as numberDelayed FROM stop_update JOIN stop_times ON stop_update.tripid = stop_times.trip_id AND stop_update.stopid = stop_times.stop_id WHERE TRIPID IN (SELECT TRIPID FROM vehicleinfo WHERE vehicleinfo.foundTimestamp = CURDATE()) AND HOUR(stop_times.arrival_time) BETWEEN HOUR(DATE_SUB(NOW(), INTERVAL 5 HOUR)) AND HOUR(NOW()) GROUP BY HOUR(stop_times.arrival_time)";
    }else{
        queryVars.push(routeName);
        query = "SELECT CONCAT(DATE_FORMAT(stop_times.arrival_time, '%h:00 %p'), \" - \", DATE_FORMAT(DATE_ADD(stop_times.arrival_time, INTERVAL 1 HOUR), '%h:00 %p')) as time, (IFNULL(sum(CASE when arrivalDelay > 180 then 1 else 0 end), 0)-IFNULL(sum(CASE when departureDelay > 180 then 1 else 0 end), 0)) as numberDelayed FROM stop_update JOIN stop_times ON stop_update.tripid = stop_times.trip_id AND stop_update.stopid = stop_times.stop_id WHERE TRIPID IN (SELECT TRIPID FROM vehicleinfo WHERE vehicleinfo.foundTimestamp = CURDATE() AND ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?)) AND HOUR(stop_times.arrival_time) BETWEEN HOUR(DATE_SUB(NOW(), INTERVAL 5 HOUR)) AND HOUR(NOW()) GROUP BY HOUR(stop_times.arrival_time)";
    }
    
    var query = con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})                    // Returns the time period & difference between late station arrivals vs. late station departures for last 6 hours according to route

api.get("/hourlyTrainsLosingGainingGroundForAll/", function(req, res){
    
    sql = "SELECT CONCAT(DATE_FORMAT(stop_times.arrival_time, '%h:00 %p'), \" - \", DATE_FORMAT(DATE_ADD(stop_times.arrival_time, INTERVAL 1 HOUR), '%h:00 %p')) as time, (IFNULL(sum(CASE when arrivalDelay > 180 then 1 else 0 end), 0)-IFNULL(sum(CASE when departureDelay > 180 then 1 else 0 end), 0)) as numberDelayed FROM stop_update JOIN stop_times ON stop_update.tripid = stop_times.trip_id AND stop_update.stopid = stop_times.stop_id WHERE `TRIPID` IN (SELECT TRIPID FROM vehicleinfo WHERE vehicleinfo.foundTimestamp = CURDATE()) AND HOUR(stop_times.arrival_time) BETWEEN HOUR(DATE_SUB(NOW(), INTERVAL 5 HOUR)) AND HOUR(NOW()) GROUP BY HOUR(stop_times.arrival_time)";
   
        
    var query = con.query(sql, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})                    // Returns the time period & difference between late station arrivals vs. late station departures for last 6 hours according to route


/* Charting & Analysis Requests */
api.get("/worstRoutes/:routeName/:dateFrom/:dateTo/:limit", function(req, res){
    var routeName = req.params.routeName, dateFrom = req.params.dateFrom, dateTo = req.params.dateTo, limit = req.params.limit, query, queryVars = [];
    if(routeName != "" && routeName.toLowerCase() != "all" && Date.parse(dateFrom) && Date.parse(dateTo) && !isNaN(limit)){
        queryVars.push(routeName, dateFrom, dateTo, parseInt(limit))
        query = "SELECT vehicleinfo.vehicleLabel, COUNT(vehicleinfo.vehicleLabel) AS DATA FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 180) AND ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?) AND DATE(vehicleinfo.foundTimestamp) BETWEEN DATE(?) AND DATE(?) GROUP BY vehicleLabel ORDER BY DATA DESC LIMIT ?";
    }else{
        query = "SELECT vehicleinfo.vehicleLabel, COUNT(vehicleinfo.vehicleLabel) AS DATA FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 180)";
    }
    con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})                      // Returns the trip names & number of journeys of trains with an average trip delay of > 3 minutes for inputs provided

/* Charting & Analysis Requests */
api.get("/worstRoutes/:routeName/", function(req, res){
    var routeName = req.params.routeName,  query, queryVars = [];
    if(routeName != "" && routeName.toLowerCase() != "all" ){
        queryVars.push(routeName)
        query = "SELECT vehicleinfo.vehicleLabel, COUNT(vehicleinfo.vehicleLabel) AS DATA FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 18) AND `routeId` IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?)";
    }else{
        query = "SELECT vehicleinfo.vehicleLabel, COUNT(vehicleinfo.vehicleLabel) AS DATA FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 180)";
    }
    con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})   // Returns the trip names & number of journeys of trains with an average trip delay of > 3 minutes for inputs provided

api.get("/allWorstRoutes/", function(req, res){
   
       var sql = "SELECT vehicleinfo.vehicleLabel FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 180); SELECT  COUNT(vehicleinfo.vehicleLabel) AS NoOfJourneys FROM vehicleinfo WHERE tripID IN (SELECT tripid FROM `stop_update` GROUP BY tripid HAVING AVG(stop_update.arrivalDelay) > 180)";
   
    con.query(sql, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
}) // Returns the trip names & number of journeys of trains with an average trip delay of > 3 minutes for inputs provided



api.get("/worstTrains/:routeName/:dateFrom/:dateTo/", function(req, res){
    var routeName = req.params.routeName, dateFrom = req.params.dateFrom, dateTo = req.params.dateTo, query, queryVars = [];
    
    if(routeName != "" && routeName.toLowerCase() != "all" && Date.parse(dateFrom) && Date.parse(dateTo)){
        queryVars.push(dateFrom, dateTo, routeName)
        query = "SELECT AVG(CASE WHEN stop_update.tripid LIKE '%.A.%' then stop_update.arrivalDelay end)/60 AS WARATAH, AVG(CASE WHEN stop_update.tripid LIKE '%.C.%' then stop_update.arrivalDelay end)/60 AS CSET, AVG(CASE WHEN stop_update.tripid LIKE '%.H.%' then stop_update.arrivalDelay end)/60 AS OSCAR, AVG(CASE WHEN stop_update.tripid LIKE '%.K.%' then stop_update.arrivalDelay end)/60 AS KSET, AVG(CASE WHEN stop_update.tripid LIKE '%.M.%' then stop_update.arrivalDelay end)/60 AS MILLENNIUM, AVG(CASE WHEN stop_update.tripid LIKE '%.S.%' then stop_update.arrivalDelay end)/60 AS SSET, AVG(CASE WHEN stop_update.tripid LIKE '%.T.%' then stop_update.arrivalDelay end)/60 AS TANGARA FROM stop_update WHERE stop_update.tripid IN (SELECT TRIPID FROM vehicleinfo WHERE DATE(FOUNDTIMESTAMP) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) AND ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?))";
    }else{
        queryVars.push(dateFrom, dateTo);
        query = "SELECT AVG(CASE WHEN stop_update.tripid LIKE '%.A.%' then stop_update.arrivalDelay end)/60 AS WARATAH, AVG(CASE WHEN stop_update.tripid LIKE '%.C.%' then stop_update.arrivalDelay end)/60 AS CSET, AVG(CASE WHEN stop_update.tripid LIKE '%.H.%' then stop_update.arrivalDelay end)/60 AS OSCAR, AVG(CASE WHEN stop_update.tripid LIKE '%.K.%' then stop_update.arrivalDelay end)/60 AS KSET, AVG(CASE WHEN statistop_updateontimes.tripid LIKE '%.M.%' then stop_update.arrivalDelay end)/60 AS MILLENNIUM, AVG(CASE WHEN stop_update.tripid LIKE '%.S.%' then stop_update.arrivalDelay end)/60 AS SSET, AVG(CASE WHEN stop_update.tripid LIKE '%.T.%' then stop_update.arrivalDelay end)/60 AS TANGARA FROM stop_update WHERE stop_update.tripid IN (SELECT TRIPID FROM vehicleinfo WHERE DATE(FOUNDTIMESTAMP) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE))";
    }
    
    
    con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})    // Returns the train name type and corresponding average station arrival delay for inputs provided


api.get("/worstStations/:routeName", function(req, res){
    var routeName = req.params.routeName, query;
    if(routeName == "" || routeName.toLowerCase() == "all"){ //return worst all stations on all routes
        query = "SELECT stops.stop_name AS ID, x.delay AS DATA from (SELECT stop_update.stopid, AVG(stop_update.arrivalDelay) as DELAY FROM stop_update GROUP BY stop_update.stopID) as x JOIN STOPS ON x.stopid = stops.stop_id ORDER BY x.delay DESC LIMIT 100";
    }else{
        query = "SELECT stops.stop_name AS ID, x.delay AS DATA from (SELECT stop_update.stopid, AVG(stop_update.arrivalDelay) as DELAY FROM stop_update WHERE TRIPID IN (SELECT TRIPID FROM VEHICLEINFO WHERE ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?)) GROUP BY stop_update.stopid HAVING AVG(stop_update.arrivalDelay) > 0) as x JOIN STOPS ON x.stopid = stops.stop_id ORDER BY x.delay DESC LIMIT 100";
    }
    con.query(query, routeName, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
}) // Returns the name of each station on route & average arrival delay, ordered by average arrival delay for inputs provided


api.get("/lateRunningTrainsGrouped/:routeName/:dateFrom/:dateTo/", function(req, res){
    var routeName = req.params.routeName, dateFrom = req.params.dateFrom, dateTo = req.params.dateTo, query, queryVars = [];
    if((new Date(dateFrom)).getTime() > 0 && (new Date(dateTo)).getTime() > 0 && routeName != "" && routeName.toLowerCase() != "all"){ // Timestamp Valid & Routename Entered
        queryVars = [dateFrom, dateTo, routeName];
        query = "SELECT COUNT(CASE WHEN arrivalDelay > 0 AND arrivalDelay <= 60 THEN 1 END) as Arrival1, COUNT(CASE WHEN arrivalDelay > 60 AND arrivalDelay <= 120 THEN 1 END) AS ARRIVAL2, COUNT(CASE WHEN arrivalDelay > 120 AND arrivalDelay <= 180 THEN 1 END) AS ARRIVAL3, COUNT(CASE WHEN arrivalDelay > 180 AND arrivalDelay <= 240 THEN 1 END) AS ARRIVAL4, COUNT(CASE WHEN arrivalDelay > 240 AND arrivalDelay <= 300 THEN 1 END) AS ARRIVAL5, COUNT(CASE WHEN arrivalDelay > 300 AND arrivalDelay <= 600 THEN 1 END) AS ARRIVAL6, COUNT(CASE WHEN arrivalDelay > 600 THEN 1 END) AS ARRIVAL7 from stop_update WHERE stop_update.tripid IN (SELECT TRIPID FROM vehicleinfo WHERE DATE(FOUNDTIMESTAMP) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) AND ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?))";
    }
    con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})               // Returns the number of station arrival delays, grouped by their respective time period for the inputs provided


api.get("/lateRunningTrainsGroupedRoutes/:routeName/", function(req, res){
    var routeName = req.params.routeName, query, queryVars = [];
    
            queryVars = [routeName];
        query = "SELECT COUNT(CASE WHEN arrivalDelay <= 60 THEN 1 END) as Arrival1, COUNT(CASE WHEN arrivalDelay > 60 AND arrivalDelay <= 120 THEN 1 END) AS ARRIVAL2, COUNT(CASE WHEN arrivalDelay > 120 AND arrivalDelay <= 180 THEN 1 END) AS ARRIVAL3, COUNT(CASE WHEN arrivalDelay > 180 AND arrivalDelay <= 240 THEN 1 END) AS ARRIVAL4, COUNT(CASE WHEN arrivalDelay > 240 AND arrivalDelay <= 300 THEN 1 END) AS ARRIVAL5, COUNT(CASE WHEN arrivalDelay > 300 AND arrivalDelay <= 600 THEN 1 END) AS ARRIVAL6, COUNT(CASE WHEN arrivalDelay > 600 THEN 1 END) AS ARRIVAL7 from stop_update WHERE stop_update.tripid IN (SELECT TRIPID FROM vehicleinfo WHERE ROUTEID IN (SELECT route_id FROM ROUTES WHERE ROUTE_LONG_NAME = ?))";
   
    con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})               // Returns the number of station arrival delays, grouped by their respective time period for only provided Route

api.get("/lateRunningTrainsGroupedForAllRoutes/", function(req, res){
    
        var sql = "SELECT COUNT(CASE WHEN arrivalDelay <= 60 THEN 1 END) as Arrival1, COUNT(CASE WHEN arrivalDelay > 60 AND arrivalDelay <= 120 THEN 1 END) AS ARRIVAL2, COUNT(CASE WHEN arrivalDelay > 120 AND arrivalDelay <= 180 THEN 1 END) AS ARRIVAL3, COUNT(CASE WHEN arrivalDelay > 180 AND arrivalDelay <= 240 THEN 1 END) AS ARRIVAL4, COUNT(CASE WHEN arrivalDelay > 240 AND arrivalDelay <= 300 THEN 1 END) AS ARRIVAL5, COUNT(CASE WHEN arrivalDelay > 300 AND arrivalDelay <= 600 THEN 1 END) AS ARRIVAL6, COUNT(CASE WHEN arrivalDelay > 600 THEN 1 END) AS ARRIVAL7 from stop_update";
   
    con.query(sql, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
})      // Returns the number of station arrival delays, grouped by their respective time period for all routes 

api.get("/cancelledTrainsBySector/:dateFrom/:dateTo/:limit", function(req, res){
    var dateFrom = req.params.dateFrom, dateTo = req.params.dateTo, limit = req.params.limit, query, queryVars = [];
    queryVars = [dateFrom, dateTo, parseInt(limit)];
    query = "SELECT CONCAT(route_short_name,' - ', route_long_name) AS ID, count(route_long_name) as DATA FROM `delays` JOIN TRIPS ON delays.delayedEntity = trips.trip_id JOIN ROUTES ON trips.route_id = routes.route_id WHERE delays.delayType = 1 AND delays.delayHeader = 'Cancelled' AND CAST(delays.timestamp AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) GROUP BY route_long_name ORDER BY DATA DESC LIMIT ?";
    var q = con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
}) // Returns the number of cancelled trains & route name for the inputs provided


api.get("/cancelledTrainsBySectorAllTime/:limit", function(req, res){
    var limit = req.params.limit, query, queryVars = [];
    queryVars = [ parseInt(limit)];
    query = "SELECT CONCAT(route_short_name,' - ', route_long_name) AS ID, count(route_long_name) as DATA FROM `delays` JOIN TRIPS ON delays.delayedEntity = trips.trip_id JOIN ROUTES ON trips.route_id = routes.route_id WHERE delays.delayType = 1 AND delays.delayHeader = 'Cancelled' GROUP BY route_long_name ORDER BY DATA DESC LIMIT ?";
    var q = con.query(query, queryVars, function(err, result){
        if(err){
            log("GET "+req.originalUrl+" Error");;
            res.end(JSON.stringify({"error":err}))
            return;
        }
        res.end(JSON.stringify(result));
    });
}) // Returns the number of cancelled trains & route name for the inputs provided


function getCurrentDate(){
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth()+1; // January is 0!
    var yyyy = today.getFullYear();

    if(dd<10) {
        dd = '0'+dd
    }
    if(mm<10) {
        mm = '0'+mm
    }
    return yyyy+"-"+mm+"-"+dd;
}
function updateFeedStatus(feedNumber, status){
    feedStatus[feedNumber] = status;
    log(feeds[feedNumber].name+" Update: "+status);
}             // Updates the feed status using the input
function log(status){
    fs.appendFile('log.txt', new Date(Date.now()).toLocaleString()+' '+status+'\r\n', function (err) {
      if (err) console.log("There was a problem logging to the file: "+err);
    });
    console.log(new Date(Date.now()).toLocaleString()+' '+status);
}
function checkTimeValid(input) {

    return isValid = /^(?:(?:([01]?\d|2[0-3]):)?([0-5]?\d):)?([0-5]?\d)$/g.test(input);
}

function blue(input){
    console.log('\x1b[35m%s\x1b[0m', input);  // Show blue console text
}                                      // Prints the input in a BLUE colour to the console



