import { qualifyBundleEntry } from './qualification.js';

self.onmessage = ({data}) => {
  try {
    self.postMessage({id: data.id, result: qualifyBundleEntry(data.entry, data.date, data.now)});
  } catch (error) {
    self.postMessage({id: data.id, error: error.message});
  }
};
