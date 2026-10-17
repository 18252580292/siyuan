import zxcvbn = require("zxcvbn");

export const estimatePassword = (password: string) => zxcvbn(password).score;
