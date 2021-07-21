/*********************************************************************
* Copyright (c) Intel Corporation 2019
* SPDX-License-Identifier: Apache-2.0
**********************************************************************/

import * as fs from 'fs'
import * as path from 'path'
import { logger as log } from './utils/logger'
import { MPSMicroservice } from './mpsMicroservice'
import { configType, certificatesType } from './models/Config'

import { certificates } from './utils/certificates'
import { tlsConfig } from './utils/tlsConfiguration'
import { IDbProvider } from './interfaces/IDbProvider'

import { SecretManagerService } from './utils/SecretManagerService'
import { parseValue } from './utils/parseEnvValue'

import rc from 'rc'
import { Environment } from './utils/Environment'
import { DeviceDb } from './db/device'
import { MqttProvider } from './utils/mqttProvider'
import { DbProvider } from './utils/DbProvider'
import { ISecretManagerService } from './interfaces/ISecretManagerService'
try {
  // To merge ENV variables. consider after lowercasing ENV since our config keys are lowercase
  process.env = Object.keys(process.env)
    .reduce((destination, key) => {
      destination[key.toLowerCase()] = parseValue(process.env[key])
      return destination
    }, {})

  // build config object
  const config: configType = rc('mps')

  if (!config.web_admin_password || !config.web_admin_user || !config.jwt_secret) {
    log.error('Web admin username, password and jwt secret are mandatory. Make sure to set values for these variables.')
    process.exit(1)
  }

  // path where Self-signed certificates are generated
  const certPath = path.join(__dirname, config.cert_path)
  config.data_path = path.join(__dirname, config.data_path)
  let certs: certificatesType

  log.silly(`Updated config... ${JSON.stringify(config, null, 2)}`)
  Environment.Config = config

  // MQTT Connection
  const mqtt: MqttProvider = new MqttProvider(config)
  mqtt.connectBroker()

  // DB initialization
  const deviceDb = new DeviceDb()
  const db: IDbProvider = new DbProvider(deviceDb)
  const secrets: ISecretManagerService = new SecretManagerService(config, log)

  // Cleans the DB before exit when it listens to the signals
  const signals = ['SIGINT', 'exit', 'uncaughtException', 'SIGTERM', 'SIGHUP']
  signals.forEach((signal) => {
    process.on(signal, () => {
      log.debug('signal received :', signal)
      deviceDb.clearInstanceStatus(Environment.Config.instance_name)
      mqtt.endBroker()
      if (signal !== 'exit') {
        setTimeout(() => process.exit(), 1000)
      }
    })
  })

  // Certificate Configuration and Operations
  if (config.https || !config.tls_offload) {
    if (!config.generate_certificates) {
      if (config.cert_format === 'raw') { // if you want to read the cert raw from variable.
        log.debug('using cert format raw')

        if (config.mps_tls_config) {
          config.mps_tls_config.key = config.tls_cert_key
          config.mps_tls_config.cert = config.tls_cert
        } else {
          config.mps_tls_config = { cert: config.tls_cert, key: config.tls_cert_key, minVersion: 'TLSv1', requestCert: true, rejectUnauthorized: false }
        }

        if (config.web_tls_config) {
          config.web_tls_config.key = config.web_tls_cert_key
          config.web_tls_config.cert = config.web_tls_cert
          config.web_tls_config.ca = config.web_tls_cert_ca
        } else {
          config.web_tls_config = { ca: config.web_tls_cert_ca, cert: config.web_tls_cert, key: config.web_tls_cert_key }
        }

        certs = { mps_tls_config: config.mps_tls_config, web_tls_config: config.web_tls_config }
      } else { // else read the certs from files
        log.debug('using cert from file')
        certs = { mps_tls_config: tlsConfig.mps(), web_tls_config: tlsConfig.web() }
      }
      log.debug('Loaded existing certificates')
    } else {
      if (!fs.existsSync(certPath)) {
        fs.mkdirSync(certPath, { recursive: true })
      }
      certs = certificates.generateCertificates(config, certPath)
    }

    log.debug('certs loaded..')

    const mps = new MPSMicroservice(config, db, secrets, certs, mqtt)
    mps.start()
  }
} catch (error) {
  log.error('Error starting MPS microservice. Check server logs.')
  log.error(error)
}
