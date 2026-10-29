import { promises } from './fs';

export const { readFile, writeFile, mkdir, readdir, unlink, access, rm } = promises;
export default promises;
