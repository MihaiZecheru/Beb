import sqlite3 from 'sqlite3';
import fetch from "node-fetch";
import { v4 as uuidv4 } from 'uuid';
import { UrlEntry, User } from './types';

export default class Database {
  private static db: sqlite3.Database = new sqlite3.Database('server.db');

  /**
   * Initializes the database by creating the necessary tables and triggers if they don't exist
   */
  public static init(): void {
    this.db.run(
`CREATE TABLE IF NOT EXISTS Users (
  user_id NCHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
      if (err) {
        console.error(err);
        throw new Error("Failed to create table");
      }
    });

    this.db.run(
`CREATE TABLE IF NOT EXISTS URLs (
    alias VARCHAR(20) PRIMARY KEY,
    url TEXT NOT NULL,
    qr_code BLOB NOT NULL,
    user_id NCHAR(36) NOT NULL,
    permanent BOOLEAN NOT NULL,
    visits INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES Users(user_id)
)`, (err) => {
      if (err) {
        console.error(err);
        throw new Error("Failed to create table");
      }
    });
  }

  /**
   * Register a user
   * 
   * @param name The user's first name or full name
   * @param email The user's email (must be unique)
   * @param password The user's password
   * @returns The ID of the newly-registered user
   */
  public static async RegisterAsync(name: string, email: string, password: string): Promise<string> { 
    return await new Promise((resolve, reject) => {
      const user_id = uuidv4();

      // Check if email is already in use
      this.db.get('SELECT user_id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during registration"));
        }

        if ((row as { user_id?: string })?.user_id)
          return reject(new Error("Email already in use"));

        // Insert user into database
        this.db.run('INSERT INTO users (user_id, name, email, password, created_at) VALUES (?, ?, ?, ?, ?)', [user_id, name, email, password, new Date().toISOString()], (err) => {
          if (err) {
            console.error(err);
            return reject(new Error("Database error during registration"));
          }
        });

        resolve(user_id);
      });
    });
  }

  /**
   * Log a user in. Verifies that the email and password match before returning his user_id
   * 
   * @returns The user_id of the user that logged in
   */
  public static async LoginAsync(email: string, password: string): Promise<string | null> {
    return await new Promise((resolve, reject) => {
        this.db.get('SELECT user_id FROM users WHERE email = ? AND password = ?', [email, password], (err, row) => {
            if (err) {
                console.error(err);
                return reject(new Error("Database error during login"));
            }

            if (!row) return resolve(null);
            resolve((row as { user_id: string }).user_id);
        });
    });
  }

  /**
   * Get a user object by his ID
   * 
   * @param user_id The ID of the user to get
   * @returns The User object of the user with the given ID, or null if the user doesn't exist
   */
  public static async GetUserByIDAsync(user_id: string): Promise<User | null> {
    return await new Promise((resolve, reject) => {
      this.db.get('SELECT name, email FROM users WHERE user_id = ?', [user_id], (err, row) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during user lookup"));
        }

        if (!row) return resolve(null);
        resolve(row as User);
      });
    });
  }

  /**
   * Create a short link in the database
   * 
   * @param creator The user ID of the creator
   * @param url The URL to shorten
   * @param alias The alias to use for the short URL
   * @param permanent True if the short URL should be permanent, false if it should expire after 7 days
   * @returns The short URL that was created
   */
  public static async CreateShortLinkAsync(creator: string, url: string, alias: string, permanent: boolean): Promise<string> {
    return await new Promise((resolve, reject) => {
      fetch(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://beb.mzecheru.com/${alias}`)
        .then((res) => res.arrayBuffer()).then((buffer) => {
        const bytes = new Uint8Array(buffer);
        return Buffer.from(bytes).toString('base64');
      }).then((qr_code) => {
        this.db.run('INSERT INTO URLs (alias, url, qr_code, user_id, permanent, visits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [alias, url, qr_code, creator, permanent, 0, new Date().toISOString()], (err) => {
          if (err) {
            console.error(err);
            return reject(new Error("Database error during short link creation"));
          }

          resolve(alias);
        });
      }).catch((err) => reject(err));
    });
  }

  /**
   * Increment the visit count for a short URL
   * 
   * @param alias The alias of the short URL, used to identify the entry in the db
   */
  public static async IncrementVisitsAsync(alias: string): Promise<void> {
    return await new Promise((resolve, reject) => {
      this.db.run('UPDATE URLs SET visits = visits + 1 WHERE alias = ?', [alias], (err) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during visit increment"));
        }

        resolve();
      });
    });
  }

  /**
   * Get a URL entry by its alias from the database
   * 
   * @param alias The alias of the short URL
   * @returns The URL entry with the given alias, or null if it doesn't exist
   */
  public static async GetURLEntryAsync(alias: string): Promise<UrlEntry | null> {
    return await new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM URLs WHERE alias = ?', [alias], (err, row) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during URL entry lookup"));
        }

        if (!row) return resolve(null);

        (row as any).permanent = (row as any).permanent === 1;
        resolve((<UrlEntry>row));
      });
    });
  }

  /**
   * Delette a URL entry from the database
   * 
   * @param alias The alias of the short URL to delete, which serves as the ID
   */
  public static async DeleteURLEntryAsync(alias: string): Promise<void> {
    return await new Promise((resolve, reject) => {
      this.db.run('DELETE FROM URLs WHERE alias = ?', [alias], (err) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during URL deletion"));
        }

        resolve();
      });
    });
  }

  /**
   * Get every URL entry that the given user made, for displaying in the dashboard
   * 
   * @param user_id The ID of the user to get the URL entries for
   * @returns A list of all the URL entries that the user created
   */
  public static async GetAllUrlsOfUserAsync(user_id: string): Promise<UrlEntry[]> {
    return await new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM URLs WHERE user_id = ?', [user_id], (err, rows) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database error during URL lookup"));
        }

        resolve(rows.map((row: any) => {
          return <UrlEntry> {
            alias: row.alias,
            url: row.url,
            qr_code: row.qr_code,
            user_id: row.user_id,
            permanent: row.permanent === 1,
            visits: row.visits,
            created_at: new Date(row.created_at)
          }
        }));
      });
    });
  }
}
