'use strict';

// DOM
const startStopBtn = document.getElementById('start-stop-btn');
const spanLatLon = document.getElementById('latlon');
const spanSpeed = document.getElementById('speed');
const selSpeed = document.getElementById('speed-sel');
const selLength = document.getElementById('length-sel');
const spanAlt1 = document.getElementById('alt1');
const spanAlt2 = document.getElementById('alt2');
const selRef = document.getElementById('ref-sel');

const UNITS = {
    speed: {
        mps: { label: 'm/s', scale: 1.0 },
        kph: { label: 'km/h', scale: 1 / 3.6 },
        mph: { label: 'mph', scale: 1.609344 / 3.6 },
        kn: { label: 'knot', scale: 1.852 / 3.6 },
    },
    alt: {
        m: { label: 'm', scale: 1.0 },
        ft: { label: 'ft', scale: 0.3048 },
    },
};
const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N',
];
const REFS = {
    none: 'Height', geoid: 'Altitude', ellipsoid: 'Ellipsoidal',
}

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
    const R = 6371009; // mean radius
    let dlat = (param2.latitude - param1.latitude) * Math.PI / 180;
    let mlat = (param1.latitude + param2.latitude) * Math.PI / 180;
    let dlon = (param2.longitude - param1.longitude) * Math.PI / 180 * Math.cos(mlat);
    let distance = R * Math.hypot(dlon, dlat);
    let heading = (Math.atan2(dlon, dlat) * 180 / Math.PI + 360) % 360;
    return { distance: distance, heading: heading };
}

function latlon2tile(latlon, z) {
    let wx = (latlon.longitude / 360 + 0.5) * 2 ** z * 256;
    let wy = (0.5 - Math.asinh(Math.tan(latlon.latitude * Math.PI / 180)) / (2 * Math.PI))
        * 2 ** z * 256;
    let tx = Math.floor(wx / 256);
    let ty = Math.floor(wy / 256);
    return {
        x: tx,
        y: ty,
        px: Math.floor(wx - tx * 256),
        py: Math.floor(wy - ty * 256),
    };
}

const CachedRequest = {
    cache: new Map(),
    fetch: function (url) {
        if (!this.cache.has(url)) {
            console.log('fetch', url);
            const promise = fetch(url)
                .catch(err => {
                    this.cache.delete(url);
                    throw err;
                });
            this.cache.set(url, promise);
        };
        return this.cache.get(url).then(res => res.clone());
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
        if (txy.y < 0 || txy.y >= 32) {
            return Promise.reject(new Error('latitude outside XYZ tile range'));
        }
        return this.fetch_xy(txy.x, txy.y).then(
            tile => tile[txy.py][txy.px]
        )
    },
}

const GPS = {
    isActive: false,
    id: null,
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
        if (GPS.params == null || params.latitude == null || GPS.params.latitude == null) {
            params.dt = null;
        } else {
            params.dt = (params.timestamp - GPS.params.timestamp) / 1000;
            dh = distance(GPS.params, params);
        };
        params.realSpeed = params.speed != null;
        if (params.speed == null && dh != null) {
            params.speed = dh.distance / params.dt;
        };
        params.realHeading = params.heading != null;
        if (params.heading == null && dh != null) {
            params.heading = dh.heading;
        };
        if (selRef.value == 'none' || params.latitude == null) {
            params.undulation = null;
        } else {
            params.undulation = EGM2008.getUndulation(params);
        }
        console.log(params);
        GPS.params = params;
        GPS.updateDisplay();
    },
    onError: function (err) {
        console.error(err.code, err.message);
        spanLatLon.textContent = 'Error: ' + err.message;
        GPS.moveTo();
    },
    updateDisplay: function () {
        // console.log('update');
        if (GPS.params == null) return;
        const params = GPS.params;
        const parts = [];
        let speedUnit = UNITS.speed[selSpeed.value];
        let lengthUnit = UNITS.alt[selLength.value];

        // latlon
        if (params.latitude != null) {
            parts.push(deg2dms(params.latitude));
            parts.push(params.latitude >= 0 ? 'N' : 'S');
            parts.push(' ');
            parts.push(deg2dms(params.longitude));
            parts.push(params.longitude >= 0 ? 'E' : 'W');
            parts.push(' ± ' + (params.accuracy / lengthUnit.scale).toFixed() + ' ' + lengthUnit.label);
            parts.push('\n');
            parts.push(params.latitude.toFixed(5) + ', ' + params.longitude.toFixed(5));
            spanLatLon.textContent = parts.join('');
        };

        // speed
        parts.splice(0);
        if (params.speed == null) {
            parts.push('- ' + speedUnit.label);
        } else {
            if (params.heading != null && params.speed >= 1.0) {
                parts.push(params.heading.toFixed() + '°');
                let compass = COMPASS[Math.round(params.heading / 22.5)];
                parts.push(' (' + compass + ')');
                parts.push(params.realHeading ? ' ' : '* ');
            };
            parts.push((params.speed / speedUnit.scale).toFixed(1));
            parts.push(params.realSpeed ? ' ' : '* ');
            parts.push(' ' + speedUnit.label);
        };
        spanSpeed.textContent = parts.join('');

        // altitude
        parts.splice(0);
        parts.push(`<b>${REFS[selRef.value]}:</b> `)
        if (params.altitude == null) {
            parts.push('- ' + lengthUnit.label);
        } else {
            parts.push((GPS.params.altitude / lengthUnit.scale).toFixed());
            if (GPS.params.altitudeAccuracy != null) {
                parts.push(' ± ' + (GPS.params.altitudeAccuracy / lengthUnit.scale).toFixed());
            };
            parts.push(' ' + lengthUnit.label);
        };
        if (selRef.value == 'none') {
            spanAlt2.textContent = '';
        } else {
            parts.push(', <b>')
            if (selRef.value == 'geoid') {
                parts.push(REFS.ellipsoid);
            } else {
                parts.push(REFS.geoid);
            }
            parts.push(':</b> ');
            spanAlt2.textContent = `- ${lengthUnit.label}`;
            if (params.altitude != null && params.undulation != null) {
                params.undulation.then(und => {
                    const parts = [];
                    let alt2 = params.altitude;
                    if (selRef.value == 'geoid') {
                        alt2 += und;
                    } else {
                        alt2 -= und;
                    }
                    parts.push((alt2 / lengthUnit.scale).toFixed());
                    parts.push(' ' + lengthUnit.label);
                    spanAlt2.innerHTML = parts.join('');
                }).catch();
            }
        };
        spanAlt1.innerHTML = parts.join('');
    },
    moveTo: function (lat = null, lon = null, alt = null) {
        const params = {
            timestamp: Date.now(),
            coords: {
                latitude: lat,
                longitude: lon,
                altitude: alt,
                accuracy: 100,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
        }
        params.toJSON = () => params;
        this.onSuccess(params);
    },
};

for (const k in UNITS.speed) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.speed[k].label;
    selSpeed.appendChild(elem);
}
for (const k in UNITS.alt) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.alt[k].label;
    selLength.appendChild(elem);
}
GPS.moveTo();
