'use strict';

// DOM
const startStopBtn = document.getElementById('start-stop-btn');
const spanLatLon = document.getElementById('latlon');
const spanSpeed = document.getElementById('speed');
const selSpeed = document.getElementById('speed-sel');
const spanAlt = document.getElementById('alt');
const selAlt = document.getElementById('alt-sel');

const UNITS = {
    SPEED: {
        mps: { 'label': 'm/s', 'scale': 1.0 },
        kph: { 'label': 'km/h', 'scale': 1 / 3.6 },
        mph: { 'label': 'mph', 'scale': 1.609344 / 3.6 },
        kn: { 'label': 'knot', 'scale': 1.852 / 3.6 },
    },
    ALT: {
        m: { 'label': 'm', 'scale': 1.0 },
        ft: { 'label': 'ft', 'scale': 0.3048 },
    },
};
const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N',
];

const LOCATION_OPTIONS = {
    enableHighAccuracy: true,
}

function deg2dms(deg) {
    let x = Math.round(Math.abs(deg) * 36000);
    let dsec = x % 600;
    x = (x - dsec) / 600;
    let min = x % 60;
    deg = (x - min) / 60;
    const parts = [
        deg, '°', min < 10 ? '0' : '', min, '\'',
        dsec < 100 ? '0' : '', (dsec / 10).toFixed(1), '"'
    ];
    return parts.join('');
};

function distance(param1, param2) {
    const R = 6371000; // mean radius
    let dlat = (param2.latitude - param1.latitude) * Math.PI / 180;
    let mlat = (param1.latitude + param2.latitude) * Math.PI / 180;
    let dlon = (param2.longitude - param1.longitude) * Math.PI / 180 * Math.cos(mlat);
    let distance = R * Math.hypot(dlat, dlon * Math.cos(mlat));
    let heading = (Math.atan2(dlon, dlat) * 180 / Math.PI + 360) % 360;
    return { distance: distance, heading: heading };
}

const GPS = {
    isActive: false,
    id: null,
    lastParams: null,
    params: null,
    toggleActive: function () {
        if (GPS.isActive) {
            GPS.isActive = false;
            navigator.geolocation.clearWatch(GPS.id);
            startStopBtn.textContent = 'Start';
            console.log('GPS paused');
        } else {
            GPS.isActive = true;
            GPS.id = navigator.geolocation.watchPosition(GPS.onSuccess, GPS.onError, LOCATION_OPTIONS);
            startStopBtn.textContent = 'Stop';
            spanLatLon.textContent = 'Waiting for a position...';
            console.log('GPS started');
        }
    },
    onSuccess: function (pos) {
        GPS.params = pos.coords.toJSON();
        GPS.params.timestamp = pos.timestamp;
        let dt = null;
        let dh = null;
        if (GPS.lastParams != null) {
            dt = (GPS.params.timestamp - GPS.lastParams.timestamp) / 1000
            dh = distance(GPS.lastParams, GPS.params);
        };
        GPS.params.realSpeed = GPS.params.speed != null;
        if (GPS.params.speed == null && dh != null) {
            GPS.params.speed = dh.distance / dt;
        };
        GPS.params.realHeading = GPS.params.heading != null;
        if (GPS.params.heading == null && dh != null) {
            GPS.params.heading = dh.heading;
        };
        console.log(GPS.params);
        GPS.lastParams = GPS.params;
        GPS.updateDisplay();
    },
    onError: function (err) {
        console.error(err.code, err.message);
        spanLatLon.textContent = 'Error: ' + err.message;
        GPS.params = null;
        spanSpeed.textContent = '-';
        spanAlt.textContent = '-';
    },
    updateDisplay: function () {
        // console.log('update');
        if (GPS.params == null) return;
        const parts = [];
        let speedUnit = UNITS.SPEED[selSpeed.value];
        let altUnit = UNITS.ALT[selAlt.value];

        // latlon
        parts.push(deg2dms(GPS.params.latitude));
        parts.push(GPS.params.latitude >= 0 ? 'N' : 'S');
        parts.push(' ');
        parts.push(deg2dms(GPS.params.longitude));
        parts.push(GPS.params.longitude >= 0 ? 'E' : 'W');
        parts.push(' ± ' + (GPS.params.accuracy / altUnit.scale).toFixed() + ' ' + altUnit.label);
        parts.push('\n');
        parts.push(GPS.params.latitude.toFixed(5) + ', ' + GPS.params.longitude.toFixed(5));
        spanLatLon.textContent = parts.join('');

        // speed
        parts.splice(0);
        if (GPS.params.speed == null) {
            parts.push('-')
        } else {
            if (GPS.params.heading != null && GPS.params.speed >= 1.0) {
                parts.push(GPS.params.heading.toFixed() + '°');
                let compass = COMPASS[Math.round(GPS.params.heading / 22.5)];
                parts.push(' (' + compass + ')');
                parts.push(GPS.params.realHeading ? ' ' : '* ');
            }
            parts.push((GPS.params.speed / speedUnit.scale).toFixed(1));
            parts.push(GPS.params.realSpeed ? ' ' : '* ');
        }
        spanSpeed.textContent = parts.join('')

        // altitude
        parts.splice(0);
        if (GPS.params.altitude == null) {
            parts.push('-');
        } else {
            parts.push((GPS.params.altitude / altUnit.scale).toFixed(1));
            if (GPS.params.altitudeAccuracy != null) {
                parts.push(' ± ' + (GPS.params.altitudeAccuracy / altUnit.scale).toFixed(1));
            };
        }
        spanAlt.textContent = parts.join('')
    },
};

for (const k in UNITS.SPEED) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.SPEED[k].label;
    selSpeed.appendChild(elem);
}
for (const k in UNITS.ALT) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.ALT[k].label;
    selAlt.appendChild(elem);
}
// GPS.toggleActive();
