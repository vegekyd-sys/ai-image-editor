if (process.env.MAKARON_LIVE !== '1') {
  console.error('Live smoke is disabled. Set MAKARON_LIVE=1 to run against the real Makaron API.');
  process.exit(0);
}

if (!process.env.MAKARON_API_KEY) {
  console.error('MAKARON_API_KEY is required for live smoke.');
  process.exit(1);
}

console.error('Live smoke is intentionally opt-in. Add focused live checks here after provisioning isolated credits.');
