class ApiError extends Error {
  constructor(status, message, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

module.exports = { ApiError };
