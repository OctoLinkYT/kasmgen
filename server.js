const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();

const ROUTES_DIR = path.join(__dirname, 'nginx/routes');

app.get('/new', (req, res) => {
    const id = Math.random().toString(36).substring(2, 8);
    const containerName = `kali-${id}`;

    try {
        // Create a temporary directory for this container's custom files
        const tempDir = path.join(__dirname, 'temp', id);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Launch container first to get access to its filesystem
        console.log(`Creating container ${containerName}...`);
        execSync(`docker run -d --name ${containerName} --network kali-proxy-demo_kalinet linuxserver/kali-linux:latest`);

        // Wait a moment for container to fully start
        console.log('Waiting for container to initialize...');
        setTimeout(() => {
            try {
                // Copy ui.js from container to temp directory
                const tempUiPath = path.join(tempDir, 'ui.js');
                console.log('Copying ui.js from container...');
                execSync(`docker cp ${containerName}:/usr/share/kasmvnc/www/ui.js "${tempUiPath}"`);

                // Read and modify ui.js
                let uiContent = fs.readFileSync(tempUiPath, 'utf8');
                
                // Replace the websockify path setting
                const originalPattern = /UI\.initSetting\('path',\s*'websockify'\);/g;
                const newPath = `UI.initSetting('path', '/user/${id}/websockify');`;
                
                if (uiContent.match(originalPattern)) {
                    uiContent = uiContent.replace(originalPattern, newPath);
                    console.log(`Updated websockify path to: /user/${id}/websockify`);
                } else {
                    // Fallback: look for other variations of the path setting
                    const fallbackPattern = /UI\.initSetting\(['"]path['"],\s*['"][^'"]*['"]?\);/g;
                    if (uiContent.match(fallbackPattern)) {
                        uiContent = uiContent.replace(fallbackPattern, newPath);
                        console.log(`Updated websockify path (fallback) to: /user/${id}/websockify`);
                    } else {
                        console.warn('Could not find websockify path setting in ui.js');
                    }
                }

                // Write modified ui.js back to temp file
                fs.writeFileSync(tempUiPath, uiContent);

                // Copy modified ui.js back to container
                console.log('Copying modified ui.js back to container...');
                execSync(`docker cp "${tempUiPath}" ${containerName}:/usr/share/kasmvnc/www/ui.js`);

                // Clean up temp file
                fs.unlinkSync(tempUiPath);
                fs.rmdirSync(tempDir);

                // Restart VNC service in container to pick up changes
                console.log('Restarting VNC service...');
                execSync(`docker exec ${containerName} supervisorctl restart kasmvnc`);

            } catch (error) {
                console.error('Error modifying ui.js:', error.message);
            }
        }, 3000); // Wait 3 seconds for container to be ready

        // Write NGINX config with websockify route
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

location /user/${id}/websockify {
    proxy_pass http://${containerName}:6901/websockify;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
        `;
        
        fs.writeFileSync(`${ROUTES_DIR}/user-${id}.conf`, conf);

        // Reload NGINX
        execSync(`docker exec kali-proxy nginx -s reload`);

        console.log(`Container ${containerName} created successfully with ID: ${id}`);
        
        // Redirect after a delay to ensure container is ready
        setTimeout(() => {
            res.redirect(`/user/${id}/`);
        }, 5000);

    } catch (error) {
        console.error('Error creating container:', error.message);
        res.status(500).send('Error creating container: ' + error.message);
    }
});

// Cleanup endpoint to remove containers and configs
app.get('/cleanup/:id', (req, res) => {
    const id = req.params.id;
    const containerName = `kali-${id}`;
    
    try {
        // Stop and remove container
        execSync(`docker stop ${containerName}`, { stdio: 'ignore' });
        execSync(`docker rm ${containerName}`, { stdio: 'ignore' });
        
        // Remove nginx config
        const configPath = `${ROUTES_DIR}/user-${id}.conf`;
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
        }
        
        // Reload nginx
        execSync(`docker exec kali-proxy nginx -s reload`);
        
        res.send(`Container ${containerName} cleaned up successfully`);
    } catch (error) {
        console.error('Error during cleanup:', error.message);
        res.status(500).send('Error during cleanup: ' + error.message);
    }
});

app.listen(3000, () => {
    console.log('Backend running on http://localhost:3000');
    
    // Ensure temp directory exists
    const tempBaseDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempBaseDir)) {
        fs.mkdirSync(tempBaseDir, { recursive: true });
    }
});