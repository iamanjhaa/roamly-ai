require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const app = require('./app');
const { connectDatabase } = require('./config/db');

const port = Number(process.env.PORT || 5000);

connectDatabase()
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`Roamly API listening on port ${port}`)))
  .catch((error) => {
    console.error(`Unable to start Roamly API: ${error.message}`);
    process.exit(1);
  });
