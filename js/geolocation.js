'use strict';

// DOM
const startStopBtn = document.getElementById('start-stop-btn');
const spanLatLon = document.getElementById('latlon');
const spanSpeed = document.getElementById('speed');
const selSpeed = document.getElementById('speed-sel');
const spanAlt = document.getElementById('alt');
const selAlt = document.getElementById('alt-sel');
const spanAlt2 = document.getElementById('alt2');
const selRef = document.getElementById('ref-sel');
const canvas = document.getElementById('canvas');

const UNITS = {
    SPEED: {
        mps: { label: 'm/s', scale: 1.0 },
        kph: { label: 'km/h', scale: 1 / 3.6 },
        mph: { label: 'mph', scale: 1.609344 / 3.6 },
        kn: { label: 'knot', scale: 1.852 / 3.6 },
    },
    ALT: {
        m: { label: 'm', scale: 1.0 },
        ft: { label: 'ft', scale: 0.3048 },
    },
};
const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N',
];

const LOCATION_OPTIONS = {
    maximumAge: 1000,
    enableHighAccuracy: true,
};

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
    const R = 637100; // mean radius
    let dlat = (param2.latitude - param1.latitude) * Math.PI / 180;
    let mlat = (param1.latitude + param2.latitude) * Math.PI / 180;
    let dlon = (param2.longitude - param1.longitude) * Math.PI / 180 * Math.cos(mlat);
    let distance = R * Math.hypot(dlat, dlon * Math.cos(mlat));
    let heading = (Math.atan2(dlon, dlat) * 180 / Math.PI + 360) % 360;
    return { distance: distance, heading: heading };
}

function latlon2tile(latlon, z) {
    let x = Math.floor((latlon.longitude / 360 + 0.5) * 2 ** z * 256);
    let y = Math.floor((0.5 - Math.asinh(Math.tan(latlon.latitude * Math.PI / 180)) / (2 * Math.PI))
        * 2 ** z * 256);
    return {
        tx: Math.floor(x / 256),
        ty: Math.floor(y / 256),
        px: x % 256,
        py: y % 256,
    };
}

const CachedRequest = {
    cache: new Map(),
    fetch: function (url) {
        if (this.cache.has(url)) {
            return this.cache.get(url);
        };
        const promise = fetch(url)
            .then(response => {
                return response;
            })
            .catch(err => {
                this.cache.delete(url);
                throw err;
            });
        this.cache.set(url, promise);
        return promise;
    },
};

const EGM2008 = {
    cache: new Map(),
    fetch_xy: function (x, y) {
        const url = `/tile/egm2008/5/${x}/${y}.png`;
        if (this.cache.has(url)) {
            return this.cache.get(url);
        };
        const promise = CachedRequest.fetch(url)
            .then(res => res.blob())
            .then(this.imblob2arr)
            .catch(err => {
                this.cache.delete(url);
                throw err;
            });
        this.cache.set(url, promise);
        return promise;
    },
    decodePixel: function (r, g, b) {
        return (((r - (r >= 128 ? 256 : 0)) * 256 + g) * 256 + b) / 100
    },
    imblob2arr: function (blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = function () {
                try {
                    const canvas = document.createElement('canvas');
                    const width = img.width;
                    const height = img.height;
                    canvas.width = width
                    canvas.height = height

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, width, height);
                    const data = imageData.data;

                    const result = new Array(height);
                    let i = 0
                    for (let y = 0; y < height; y++) {
                        const row = new Array(width);
                        for (let x = 0; x < width; x++) {
                            row[x] = EGM2008.decodePixel(
                                data[i], data[i + 1], data[i + 2]);
                            i += 4;
                        }
                        result[y] = row;
                    }
                    resolve(result);
                } catch (e) {
                    reject(e)
                };
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    },
    getUndulation: function (latlon) {
        const txy = latlon2tile(latlon, 5);
        if (txy.ty < 0 || txy.ty >= 32) {
            throw new Error('latitude outside XYZ tile range')
        }
        return this.fetch_xy(txy.tx, txy.ty).then(
            tile => tile[txy.py][txy.px]
        )
    },
}

const GPS = {
    isActive: false,
    id: null,
    lastParams: null,
    params: null,
    toggleActive: function () {
        if (this.isActive) {
            this.isActive = false;
            navigator.geolocation.clearWatch(this.id);
            startStopBtn.textContent = 'Start';
            console.log('GPS paused');
        } else {
            this.isActive = true;
            this.id = navigator.geolocation.watchPosition(this.onSuccess, this.onError, LOCATION_OPTIONS);
            startStopBtn.textContent = 'Stop';
            spanLatLon.textContent = 'Waiting for a position...';
            console.log('GPS started');
        }
    },
    onSuccess: function (pos) {
        const params = pos.toJSON().coords;
        params.timestamp = pos.timestamp;
        let dh = null;
        if (GPS.lastParams == null) {
            params.dt = null;
        } else {
            params.dt = (params.timestamp - GPS.lastParams.timestamp) / 1000;
            dh = distance(GPS.lastParams, params);
        };
        params.realSpeed = params.speed != null;
        if (params.speed == null && dh != null) {
            params.speed = dh.distance / params.dt;
        };
        params.realHeading = params.heading != null;
        if (params.heading == null && dh != null) {
            params.heading = dh.heading;
        };
        params.undulation = EGM2008.getUndulation(params);
        console.log(params);
        GPS.lastParams = GPS.params;
        GPS.params = params;
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
        const params = GPS.params;
        const parts = [];
        let speedUnit = UNITS.SPEED[selSpeed.value];
        let altUnit = UNITS.ALT[selAlt.value];

        // latlon
        parts.push(deg2dms(params.latitude));
        parts.push(params.latitude >= 0 ? 'N' : 'S');
        parts.push(' ');
        parts.push(deg2dms(params.longitude));
        parts.push(params.longitude >= 0 ? 'E' : 'W');
        parts.push(' ± ' + (params.accuracy / altUnit.scale).toFixed() + ' ' + altUnit.label);
        parts.push('\n');
        parts.push(params.latitude.toFixed(5) + ', ' + params.longitude.toFixed(5));
        spanLatLon.textContent = parts.join('');

        // speed
        parts.splice(0);
        if (params.speed == null) {
            parts.push('-');
        } else {
            if (params.heading != null && params.speed >= 1.0) {
                parts.push(params.heading.toFixed() + '°');
                let compass = COMPASS[Math.round(params.heading / 22.5)];
                parts.push(' (' + compass + ')');
                parts.push(params.realHeading ? ' ' : '* ');
            };
            parts.push((params.speed / speedUnit.scale).toFixed(1));
            parts.push(params.realSpeed ? ' ' : '* ');
        };
        spanSpeed.textContent = parts.join('');

        // altitude
        parts.splice(0);
        if (params.altitude == null) {
            spanAlt.textContent = '-';
        } else {
            parts.push((GPS.params.altitude / altUnit.scale).toFixed());
            if (GPS.params.altitudeAccuracy != null) {
                parts.push('± ' + (GPS.params.altitudeAccuracy / altUnit.scale).toFixed());
            };
            spanAlt.textContent = parts.join(' ');

            if (selRef.value == 'none') {
                spanAlt2.textContent = '';
            } else {
                params.undulation.then(und => {
                    let alt2 = params.altitude;
                    let otherRef = '';
                    if (selRef.value == 'geoid') {
                        alt2 += und;
                        otherRef = 'Ellipsoid';
                    } else {
                        alt2 -= und;
                        otherRef = 'Geoid';
                    }
                    const parts = [',', (alt2 / altUnit.scale).toFixed(),
                        altUnit.label, otherRef];
                    spanAlt2.textContent = parts.join(' ');
                }).catch(e => {
                    spanAlt2.textContent = '-';
                });
            };
        };
    },
    moveTo: function (lat, lon, alt = null) {
        const params = {
            timestamp: Date.now(),
            coords: {
                latitude: lat,
                longitude: lon,
                altitude: alt,
                accuracy: 100,
                altitudeAccuracy: null
            },
        }
        params.toJSON = () => params;
        this.onSuccess(params);
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
