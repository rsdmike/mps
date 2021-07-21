/*********************************************************************
 * Copyright (c) Intel Corporation 2020
 * SPDX-License-Identifier: Apache-2.0
 * Description: Handler to get AMT Features
 * Author: Madhavi Losetty
 **********************************************************************/

import { Response, Request } from 'express'
import { logger as log } from '../../utils/logger'
import { amtPort, AMTFeaturesConst, UserConsentOptions } from '../../utils/constants'
import { ErrorResponse } from '../../utils/amtHelper'
import { AMTFeatures } from '../../utils/AMTFeatures'
import { MPSValidationError } from '../../utils/MPSValidationError'

export async function getAMTFeatures (req: Request, res: Response): Promise<void> {
  let redir, sol, ider, kvm, userConsent
  try {
    const payload = req.body
    const guid = req.params.guid
    const ciraconn = req.mpsService.mpsserver.ciraConnections[guid]
    if (ciraconn && ciraconn.readyState === 'open') {
      await req.mpsService.mqtt.publishEvent('request', ['AMT_GetFeatures'], 'Get AMT Features Requested', guid)

      const cred = await req.mpsService.secrets.getAMTCredentials(guid)
      const amtstack = req.amtFactory.getAmtStack(guid, amtPort, cred[0], cred[1], 0)
      const wsmanResponse = await AMTFeatures.getAMTFeatures(amtstack, payload)
      amtstack.wsman.comm.socket.sendchannelclose()
      if (wsmanResponse[AMTFeaturesConst.AMT_REDIR_SERVICE] &&
                      wsmanResponse[AMTFeaturesConst.AMT_KVM_REDIR] &&
                      wsmanResponse[AMTFeaturesConst.AMT_OPTIN_SERVICE]) {
        const amtRedirResponse = wsmanResponse[AMTFeaturesConst.AMT_REDIR_SERVICE].response
        const kvmRedirResponse = wsmanResponse[AMTFeaturesConst.AMT_KVM_REDIR].response
        const optServiceRes = wsmanResponse[AMTFeaturesConst.AMT_OPTIN_SERVICE].response

        redir = (amtRedirResponse[AMTFeaturesConst.AMT_REDIR_LISTENER] === true)
        sol = ((amtRedirResponse[AMTFeaturesConst.AMT_REDIR_STATE] & 2) !== 0)
        ider = ((amtRedirResponse[AMTFeaturesConst.AMT_REDIR_STATE] & 1) !== 0)
        kvm = ((kvmRedirResponse.EnabledState === 6 && kvmRedirResponse.RequestedState === 2) ||
                          kvmRedirResponse.EnabledState === 2 || kvmRedirResponse.EnabledState === 6)

        const value = optServiceRes[AMTFeaturesConst.AMT_USER_CONSENT]
        userConsent = Object.keys(UserConsentOptions).find(key => UserConsentOptions[key] === value)

        await req.mpsService.mqtt.publishEvent('success', ['AMT_GetFeatures'], 'Get AMT Features', guid)
        res.status(200).json({ userConsent: userConsent, redirection: redir, KVM: kvm, SOL: sol, IDER: ider }).end()
      }
    } else {
      await req.mpsService.mqtt.publishEvent('fail', ['AMT_GetFeatures'], 'Device Not Found', guid)
      res.status(404).json(ErrorResponse(404, `guid : ${guid}`, 'device')).end()
    }
  } catch (error) {
    log.error(`Exception in get AMT Features: ${error}`)
    if (error instanceof MPSValidationError) {
      return res.status(error.status || 400).json(ErrorResponse(error.status || 400, error.message)).end()
    } else {
      await req.mpsService.mqtt.publishEvent('fail', ['AMT_GetFeatures'], 'Internal Server Error')
      return res.status(500).json(ErrorResponse(500, 'Request failed during get AMT Features.')).end()
    }
  }
}
