module.exports = {
  apps: [{
    name: 'asiste-healthcare-backend',
    script: './src/index.js',
    cwd: '/var/www/asiste-healthcare-backend',
    node_args: '-r dotenv/config',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5002
    },
    error_file: '/var/log/pm2/asiste-healthcare-backend-error.log',
    out_file: '/var/log/pm2/asiste-healthcare-backend-out.log',
    log_file: '/var/log/pm2/asiste-healthcare-backend-combined.log',
    time: true
  }]
};
