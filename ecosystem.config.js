module.exports = {
  apps: [
    {
      name: 'api.optparts.kz',
      script: 'dist/main.js',
      instances: 1,        // one process per CPU core
      exec_mode: 'cluster',    // load balance across instances
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_file: '.env',        // loads your .env automatically
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',
      time: true,              // timestamp on every log line
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};