const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();

const ROUTES_DIR = path.join(__dirname, 'nginx/routes');

app.get('/new', (req, res) => {
    const id = Math.random().toString(36).substring(2, 8);
    const containerName = `kali-${id}`;

    // Launch container
    execSync(`docker run -d --name ${containerName} --network kali-proxy-demo_kalinet linuxserver/kali-linux:latest`);

    // Write NGINX config (no separate /websockify route needed)
    const conf = `
location /user/${id}/ {
    proxy_pass http://${containerName}:6901/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    rewrite ^/user/${id}(/.*)?$ $1 break;
}
    `;
    fs.writeFileSync(`${ROUTES_DIR}/user-${id}.conf`, conf);

    // Reload NGINX
    execSync(`docker exec kali-proxy nginx -s reload`);

    // Redirect
    res.redirect(`/user/${id}/`);
});

app.listen(3000, () => {
    console.log('Backend running on http://localhost:3000');
});
