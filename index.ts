import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import Database from './database';
import { UrlEntry, User } from './types';

dotenv.config();
Database.init();

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');

/**
 * Serve the home page
 */
app.get('/', (req: Request, res: Response) => {
  setTimeout(() => res.render('index'), 250);
});

/**
 * Serve the login page
 */
app.get('/login', (req: Request, res: Response) => {
  res.render('login');
});

function formatURL(url: string): string {
  url = url.replace('https://', '');
  if (url[url.length - 1] === '/')
    url = url.slice(0, -1);
  return url.length > 30 ? url.slice(0, 30) + '...' : url;
}

/**
 * Serve the user's dashboard
 */
app.get('/dashboard/:user_id', async (req: Request, res: Response) => {
  const user_id = req.params.user_id;

  const user: User | null = await Database.GetUserByIDAsync(user_id);
  if (!user) {
    return res.redirect('/login');
  }

  const URLs: UrlEntry[] = await Database.GetAllUrlsOfUserAsync(user_id);

  const expiration_dates = URLs.map((url_entry) => {
    if (!url_entry.permanent) {
      const expiration_date = new Date(url_entry.created_at);
      expiration_date.setDate(expiration_date.getDate() + 7);
      if (new Date(new Date().toISOString()) > new Date(expiration_date.toISOString()))
        return "Expired";
      else return expiration_date.toLocaleDateString();
    } else {
      return "Never";
    }
  });

  const formatted_urls = URLs.map((url_entry) => formatURL(url_entry.url));
  
  if (URLs.length > 0) {
    res.render('dashboard', { user, URLs, expiration_dates, formatted_urls });
  } else {
    res.render('empty-dashboard');
  }
});

/**
 * Redirect to the user's dashboard or redirect to home (/) if the user isn't logged in
 */
app.get('/dashboard', (req: Request, res: Response) => {
  res.render('dashboard-redirect');
});

/**
 * Log a user in with his username and password
 */
app.post('/api/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  Database.LoginAsync(email, password)
    .then((user_id) => {
      if (!user_id) {
        res.send({ error: 'Invalid username or password', user_id: null });
      } else {
        res.send({ error: null, user_id });
      }
    }).catch((err) => {
      // Internal error
      res.send({ error: err.message, user_id: null });
    });
});

/**
 * Register / sign up a new user
 */
app.post('/api/register', (req: Request, res: Response) => {
  const { name, email, password } = req.body;

  Database.RegisterAsync(name, email, password)
    .then((user_id) => {
      res.send({ error: null, user_id });
    })
    .catch((err) => {
      // Internal error
      res.send({ error: err.message, user_id: null });
    });
});

/**
 * Serve the favicon
 */
app.get('/icon.png', (req: Request, res: Response) => {
  res.sendFile(__dirname + '/icon.png');
});

/**
 * Create a new short link
 */
app.post('/create', async (req: Request, res: Response) => {
  const { creator, url, alias, permanent } = req.body;

  if (!creator || !url || !alias || permanent === undefined) {
    res.send({ error: 'Missing parameters - requires `url`, `permanent`, and `creator`', short_url: null });
    return;
  }

  if (permanent !== true && permanent !== false) {
    res.send({ error: 'Invalid parameter - `permanent` must be a boolean', short_url: null });
    return;
  }

  if (!alias.match(/^[a-zA-Z0-9-_]+$/)) {
    res.send({ error: 'Invalid alias - must only contain letters, numbers, dashes, and underscores', short_url: null });
    return;
  }

  if (alias.length > 20) {
    res.send({ error: 'Invalid alias - must be 20 characters or less', short_url: null });
    return;
  }

  if (["create", "view", "api", "dashboard", "login"].includes(alias)) {
    res.send({ error: 'Invalid alias - cannot use reserved keyword', short_url: null });
    return;
  }

  if (!await Database.GetUserByIDAsync(creator)) {
    res.send({ error: 'Invalid user - user does not exist', short_url: null });
    return;
  }

  const url_regex = new RegExp(/^(https?:\/\/)?([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+)(\/[^\s]*)?$/);
  if (!url_regex.test(url)) {
    res.send({ error: 'Invalid URL', short_url: null });
    return;
  }

  if ((await Database.GetURLEntryAsync(alias))?.url) {
    res.send({ error: 'Alias already in use', short_url: null });
    return;
  }

  Database.CreateShortLinkAsync(creator, url, alias, permanent)
    .then((short_url) => {
      res.send({ error: null, short_url });
    })
    .catch((err) => {
      res.send({ error: err.message, short_url: null });
    });
});

/**
 * View a short link's details
 */
app.get('/view/:alias', async (req: Request, res: Response) => {
  const alias = req.params.alias;

  const url_entry: UrlEntry | null = await Database.GetURLEntryAsync(alias);
  if (!url_entry?.url) {
    res.send({ error: 'Invalid alias', short_url: null });
    return;
  }

  let expiration_date_string: string;
  if (!url_entry.permanent) {
    const expiration_date = new Date(url_entry.created_at);
    expiration_date.setDate(expiration_date.getDate() + 7);
    if (new Date(new Date().toISOString()) > new Date(expiration_date.toISOString()))
      expiration_date_string = "Expired";
    else expiration_date_string = expiration_date.toLocaleDateString();
  } else {
    expiration_date_string = "Never";
  }

  res.render('view', { url_entry, expiration_date: expiration_date_string });
});

/**
 * Redirect to the original URL - URL shortener main functionality
 */
app.get('/:alias', async (req: Request, res: Response) => {
  const alias = req.params.alias;

  const link: UrlEntry | null = await Database.GetURLEntryAsync(alias);

  // If the alias does not exist
  if (!link?.url) {
    return res.redirect('/');
  }

  // Check to see if the link is expired. If so, redirect to /view/alias so the user can see that it's expired.
  if (!link.permanent) {
    const expiration_date = new Date(link.created_at);
    expiration_date.setDate(expiration_date.getDate() + 7);
    // If expired
    if (new Date(new Date().toISOString()) > new Date(expiration_date.toISOString())) {
      return res.redirect(`/view/${alias}`);
    }
  }

  Database.IncrementVisitsAsync(alias);
  res.redirect(link.url);
});

/**
 * Delete URL entry
 */
app.delete('/:alias', async (req: Request, res: Response) => {
  const alias = req.params.alias;

  const link: UrlEntry | null = await Database.GetURLEntryAsync(alias);
  if (!link?.url) {
    res.send({ error: 'Invalid alias', short_url: null });
    return;
  }

  Database.DeleteURLEntryAsync(alias)
    .then(() => {
      res.send({ error: null, message: 'URL entry deleted' });
    })
    .catch((err) => {
      res.send({ error: err.message, message: null });
    });
});

const __PORT__ = process.env.PORT || 4001;
app.listen(__PORT__, () => {
  console.log(`\nServer is running on http://localhost:${__PORT__}\n`);
});
