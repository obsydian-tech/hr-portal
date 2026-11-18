// MOD-01: new. The SDK credential helpers a script may use for its --profile (fromIni, fromNodeProviderChain and the
// like). Each returns a provider of fake credentials; nothing is read from disk and nothing reaches AWS.
const creds = async () => ({ accessKeyId: 'mod01-fake', secretAccessKey: 'mod01-fake' });
const provider = () => creds;
export const fromIni = provider;
export const fromEnv = provider;
export const fromNodeProviderChain = provider;
export const fromSSO = provider;
export const fromProcess = provider;
export const fromTemporaryCredentials = provider;
export const defaultProvider = provider;
export default { fromIni, fromEnv, fromNodeProviderChain, fromSSO, fromProcess, fromTemporaryCredentials, defaultProvider };
