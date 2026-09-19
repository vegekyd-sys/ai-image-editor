#!/usr/bin/env node

import { authorizeXaiDevice, getCredentialPath } from './xai-oauth.mjs';

try {
  await authorizeXaiDevice({
    onCode: async device => {
      const url = device.verificationUriComplete || device.verificationUri;
      const minutes = Math.max(1, Math.round(device.expiresInMs / 60_000));
      process.stdout.write([ 
        '',
        'Open this URL in your browser:',
        url,
        '',
        `Code: ${device.userCode}`,
        `Expires in approximately ${minutes} minutes.`,
        '',
        'Waiting for authorization...',
        '',
      ].join('\n'));
    },
  });
  process.stdout.write(`xAI OAuth complete. Credential saved to ${getCredentialPath()}.\n`);
} catch (error) {
  process.stderr.write(`xAI OAuth failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
