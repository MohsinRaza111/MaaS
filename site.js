var siteAddr = "/api";
var daysOfTheWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var monthsAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function getDayOfWeek(dateString){
    return daysOfTheWeek[new Date(dateString).getDay()];
}
function getPrettyDate(dateString){
    var date = new Date(dateString);
    
    return daysOfTheWeek[date.getDay()].substr(0,3) + " " + date.getDate() + " " + monthsAbbr[date.getMonth()];
}
function formatTime(date){
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0'+minutes : minutes;
    var strTime = hours + ':' + minutes + ' ' + ampm;
    return strTime;
}
function getTimeOfDay(timeString){
    var date = new Date(timeString);
    var date2 = new Date(timeString);
    date2.setHours(date2.getHours()-1);
    return formatTime(date2) + " - " + formatTime(date);
}

/* LIVE MAP  */
function plotStations(){
        $.getJSON(siteAddr+"/stations/", function(data){
            $.each(data, function(number, data){
                L.circle([data.stop_lat, data.stop_lon], {
                radius: 100,
                fillColor: "#bfbfbf",
                color: "#ffffff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8}).bindTooltip(data.stop_name).openTooltip().addTo(map);
            })
        })
    }
function drawLines(){
    var lastTrack = null;
    var trackCoordinates = [];

    $.getJSON(siteAddr+"/shapes/", function(data){
        $.each(data, function(number, data){

            if(lastTrack != null && lastTrack.id != data.id){
                L.polyline(trackCoordinates, {color: "#" + lastTrack.colour, weight: 3}).addTo(map);
                trackCoordinates = [];
            }

            lastTrack = data;
            trackCoordinates.push([data.lat, data.lon])
        })
    })
}
function updateTrains(){
    $.getJSON(siteAddr+"/currentTrains/", function(data){
        removeTrains();
        $.each(data, function(number, data){
            var text = '<div style="text-align:center;"><b>'+data.vehicleLabel+'</b><br><i>'+data.routeName+'</i><br>'+getTrainDescription(data.tripid)+'<br>'+getTimeDifference(data.timestamp)+'</div>';
            trainPlots.push(L.circle([data.latitude, data.longitude], {
            radius: 80,
            fillColor: "#ff0000",
            color: "#ff0000",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8}).bindTooltip(text).openTooltip().addTo(map));
        })
    })
}
function getTimeDifference(timestamp){
    var diff = (Math.round((new Date()).getTime() / 1000)-timestamp);
    
    if(diff < 60){
        return "Updated: "+diff+" secs ago";
    }else{
        return "Updated: "+Math.floor(diff/60)+" min(s) ago";
    }
    
    
};
function removeTrains(){
    for(var x=0;x<trainPlots.length;x++){
        map.removeLayer(trainPlots[x]);
    }
}
function getTrainDescription(tripID){
    if(tripID.split(".")[0] == "NonTimetabled"){
        return "Unscheduled Train ("+tripID.split(".")[1]+")";
    }
    
    var returnString = tripID.split(".")[5] + " Carriage ";
    switch(tripID.split(".")[4]){
        case "A":
            returnString += " Waratah"; 
            break;
        case "C":
            returnString += " C Set"; 
            break;
        case "H":
            returnString += " Oscar"; 
            break;
        case "J":
            returnString += " Hunter"; 
            break;
        case "K":
            returnString += " K Set"; 
            break;
        case "M":
            returnString += " Millennium"; 
            break;
        case "N":
            returnString += " Endeavour"; 
            break;
        case "P":
            returnString += " Xplorer"; 
            break;
        case "S":
            returnString += " S Set"; 
            break;
        case "T":
            returnString += " Tangara"; 
            break;
        case "V":
            returnString += " Intercity"; 
            break;
        case "X":
            returnString += " XPT"; 
            break;
        case "Z":
            returnString += " Indian Pacific"; 
            break;
        case "B":
            returnString += " Bus"; 
            break;
        case "D":
            returnString += " Diesel Locomotive Train"; 
            break;
        case "F":
            returnString += " Slow Freight Train"; 
            break;
        case "L":
            returnString += " Lt Locomotive"; 
            break;
        case "O":
            returnString += " Other Train"; 
            break;
        case "Q":
            returnString += " Maintenance Track Machine"; 
            break;
        case "W":
            returnString += " Fast Freight Train"; 
            break;
        case "Y":
            returnString += " Other Train"; 
            break;
        default:
            returnString += " Train ("+tripID.split(".")[4]+" set)"; 
    }
    return returnString;
}
function getDateToday(){
    var today = new Date();
    var dd = today.getDate();
    var mm = today.getMonth()+1; //January is 0!
    var yyyy = today.getFullYear();
    if(dd<10){
        dd='0'+dd
    } 
    if(mm<10){
        mm='0'+mm
    } 

    return (yyyy+'-'+mm+'-'+dd);
}


var colourCounter = 0;
function randomColour(){
    var colours = ["#CC0000", "#FF8800", "#007E33", "#0099CC", "#0d47a1", "#00695c", "#9933CC"];
    return colours[(colourCounter++%7)];
}