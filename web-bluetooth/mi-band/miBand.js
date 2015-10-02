(() => {
  'use strict';

  let encoder = new TextEncoder('utf-8');
  let decoder = new TextDecoder('utf-8');

  const batteryStatusCodes = new Map([[0, "Unknown"],
                               [1, "Battery Low"],
                               [2, "Battery charging"],
                               [3, "Battery full (charging)"],
                               [4, "Not charging"]]);

  /* Custom Bluetooth Service UUIDs */

  const MIBAND_SERVICE_UUID = 0xFEEE0;

  /* Custom Bluetooth Characteristic UUIDs */

  const BATTERY_INFO_UUID = 0xFF0C;
  const BLE_CONNECTION_PARAMETERS_UUID = 0xFF09;
  const CONTROL_POINT_UUID = 0xFF05;;
  const DATETIME_UUID = 0xFF0A;
  const DEVICE_INFO_UUID = 0xFF01;
  const DEVICE_NAME_UUID = 0xFF02;
  const STEPS_UUID = 0xFF06;
  const USER_INFO_UUID = 0xFF04;


  class MiBand {
    constructor() {
      this.device = null;
      this.server = null;
      this.service = null;
      this._debug = true;
    }
    requestDevice() {
      return navigator.bluetooth.requestDevice({filters:[{services:[ MIBAND_SERVICE_UUID ]}]})
      .then(device => {
        this.device = device;
        return device.connectGATT();
      })
      .then(server => {
        this.server = server;
        return server.getPrimaryService(MIBAND_SERVICE_UUID).then(service => {
          return Promise.all([
            this._cacheCharacteristic(service, BATTERY_INFO_UUID),
            this._cacheCharacteristic(service, BLE_CONNECTION_PARAMETERS_UUID),
            this._cacheCharacteristic(service, CONTROL_POINT_UUID),
            this._cacheCharacteristic(service, DATETIME_UUID),
            this._cacheCharacteristic(service, DEVICE_INFO_UUID),
            this._cacheCharacteristic(service, DEVICE_NAME_UUID),
            this._cacheCharacteristic(service, STEPS_UUID),
            this._cacheCharacteristic(service, USER_INFO_UUID),
          ])
        });
      })
      .then(() => this.device); // Returns device when fulfilled.
    }

    /* MiBand Service */

    getDeviceInfo() {
      return this._readCharacteristicValue(DEVICE_INFO_UUID)
      .then(data => {
        let deviceInfo = new Map();
        deviceInfo.set('firmwareVersion', data.getUint8(15) + '.' + data.getUint8(14) + '.' + data.getUint8(13) + '.' + data.getUint8(12));
        deviceInfo.set('profileVersion', data.getUint8(11) + '.' + data.getUint8(10) + '.' + data.getUint8(9) + '.' + data.getUint8(8));
        // TODO: Get feature, appearance, hardwareVersion.
        return deviceInfo;
      });
    }
    getDeviceName() {
      return this._readCharacteristicValue(DEVICE_NAME_UUID)
      .then(this._decodeString);
    }
    getBatteryInfo() {
      return this._readCharacteristicValue(BATTERY_INFO_UUID)
      .then(data => {
        let lastChargeDate = new Date(2000 + data.getUint8(1),
                                      data.getUint8(2),
                                      data.getUint8(3),
                                      data.getUint8(4),
                                      data.getUint8(5),
                                      data.getUint8(6));
        let batteryInfo = new Map();
        batteryInfo.set('batteryLevel', data.getUint8(0));
        batteryInfo.set('batteryStatusCode', data.getUint8(9));
        batteryInfo.set('batteryStatusText', batteryStatusCodes.get(data.getUint8(9)));
        batteryInfo.set('batteryCharges', 0xffff & (0xff & data.getUint8(7) | (0xff & data.getUint8(8) << 8)));
        batteryInfo.set('batteryLastCharge', lastChargeDate);
        return batteryInfo;
      });
    }
    getSteps() {
      return this._readCharacteristicValue(STEPS_UUID)
      .then(data => {
        return data.getUint8(0) + (data.getUint8(1) << 8)
      });
    }
    getBluetoothConnectionParameters() {
      return this._readCharacteristicValue(BLE_CONNECTION_PARAMETERS_UUID)
      .then(data => {
        let connIntMin = 0xffff & (0xff & data.getUint8(0) | (0xff & data.getUint8(1)) << 8)
        let connIntMax = 0xffff & (0xff & data.getUint8(2) | (0xff & data.getUint8(3)) << 8)
        let latency = 0xffff & (0xff & data.getUint8(4) | (0xff & data.getUint8(5)) << 8)
        let timeout = 0xffff & (0xff & data.getUint8(6) | (0xff & data.getUint8(7)) << 8)
        let connInt = 0xffff & (0xff & data.getUint8(8) | (0xff & data.getUint8(9)) << 8)
        let advInt = 0xffff & (0xff & data.getUint8(10) | (0xff & data.getUint8(11)) << 8)

        let connectionParams = new Map();
        connectionParams.set('minConnectionInterval', connIntMin * 1.25);
        connectionParams.set('maxConnectionInterval', connIntMax * 1.25);
        connectionParams.set('latency', latency);
        connectionParams.set('supervisionTimeout', timeout * 10);
        connectionParams.set('connectionInterval', connInt * 1.25);
        connectionParams.set('advertisingInterval', advInt * 0.625);

        return connectionParams;
      });
    }
    getDateTime() {
      return this._readCharacteristicValue(DATETIME_UUID)
      .then(data => {
        let date = new Date(data.getUint8(0) + 2000,
                            data.getUint8(1),
                            data.getUint8(2),
                            data.getUint8(3),
                            data.getUint8(4),
                            data.getUint8(5));
        return date;
      });
    }
    setUserInfo() {
      let uuid = 1586927552; // UUID must have 10 digits.
      let gender = 1; // Gender (Female 0, Male 1)
      let age = 32; // Age in years.
      let height = 170; // Height in cm.
      let weight = 70; // Weight in kg.
      let type = 1; // If 1, all saved data will be lost.

      let userInfo = [];
      for (var i = 0; i < 4; i++) { userInfo.push(uuid & 0xff); uuid >>= 8; }
      userInfo.push(gender);
      userInfo.push(age);
      userInfo.push(height);
      userInfo.push(weight);
      userInfo.push(type);
      for (var i = 0; i < 10; i++) { /* Alias */ userInfo.push(0); }
      let crc = (this._computeCRC(userInfo) ^ parseInt(this.device.instanceID.slice(-2), 16));
      userInfo.push(crc);

      return this._writeCharacteristicValue(USER_INFO_UUID, new Uint8Array(userInfo));
    }
    setDateTime() {
      let today = new Date();
      let date = [(today.getFullYear() - 2000) & 0xff,
                  today.getMonth(),
                  today.getDate(),
                  today.getHours(),
                  today.getMinutes(),
                  today.getSeconds()];
      return this._writeCharacteristicValue(DATETIME_UUID, new Uint8Array(date));
    }
    setProgressLightColor(red, green, blue) {
      // Ranges go from 0 (LED off) to 6 (max bright).
      let color = [0x0e, red, green, blue, 0x01];
      return this._writeCharacteristicValue(CONTROL_POINT_UUID, new Uint8Array(color));
    }
    setBandLocation(loc) {
      // Left hand (0), right hand (1), neck (2).
      return this._writeCharacteristicValue(CONTROL_POINT_UUID, new Uint8Array([0x0f, loc]));
    }
    locate() {
      return this._writeCharacteristicValue(CONTROL_POINT_UUID, new Uint8Array([8, 0]));
    }
    factoryReset() {
      return this._writeCharacteristicValue(CONTROL_POINT_UUID, new Uint8Array([9]));
    }
    test() {
      return this._writeCharacteristicValue(0xFF0D, new Uint8Array([1]));
    }
    vibrate() {
      // Start vibrating.
      return this._writeCharacteristicValue(0xFF0D, new Uint8Array([8, 0]))
      .then(() => {
        return new Promise(function(resolve, reject) {
          let stopVibration = new Uint8Array([19]);
          setTimeout(() => {
            resolve(() => {
              // Stop vibrating.
              return this._writeCharacteristicValue(0xFF0D, new Uint8Array([19]))
            });
          }, 1000);
        });
      });
    }

    /* Utils */

    _cacheCharacteristic(service, characteristicUuid) {
      return service.getCharacteristic(characteristicUuid)
      .then(characteristic => {
        this._characteristics.set(characteristicUuid, characteristic);
      });
    }
    _readCharacteristicValue(characteristicUuid) {
      let characteristic = this._characteristics.get(characteristicUuid);
      return characteristic.readValue()
      .then(buffer => {
        let data = new DataView(buffer);
        if (this._debug) {
          for (var i = 0, a = []; i < data.byteLength; i++) { a.push(data.getUint8(i)); }
          console.debug('READ', characteristic.uuid, a);
        }
        return data;
      });
    }
    _writeCharacteristicValue(characteristicUuid, value) {
      let characteristic = this._characteristics.get(characteristicUuid);
      if (this._debug) {
        console.debug('WRITE', characteristic.uuid, value);
      }
      return characteristic.writeValue(value);
    }
    _computeCRC(data) {
      let crc = 0;
      for (var i = 0; i < data.length; ++i) {
        crc ^= data[i];
        for (var j = 0; j < 8; ++j) {
          let odd = crc & 1;
          crc = crc >> 1;
          if (odd) crc ^= 140;
        }
      }
      return crc;
    }
    _decodeString(data) {
      return decoder.decode(data);
    }
    _encodeString(data) {
      return encoder.encode(data);
    }
  }

  window.miBand = new MiBand();

})();
