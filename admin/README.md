# Local blog publisher

The publishing endpoint intentionally runs only on your computer. From the repository root, choose a private password and start it with:

```bash
BLOG_ADMIN_PASSWORD='choose-a-strong-password' node admin/server.mjs
```

Do not put that password in a tracked file, the HTML, or a Git commit. Then open the printed `http://127.0.0.1:4173/admin/index.html` address. Click **Unlock publishing** and enter the password. The **Publish** button appears only after successful authentication and will:

1. write the post to `blog/<slug>/index.html`;
2. add or replace its entry in `blog/index.html` and sort entries by month;
3. stage the blog, admin, shared styles, and interactive-figure runtime;
4. commit the changes; and
5. push `main` to `origin`.

Authentication is enforced by the publishing endpoint, not just by hiding the button. A successful login creates an HttpOnly, same-site session that expires after 12 hours; click **Lock** to end it sooner. Five incorrect attempts temporarily lock login for ten minutes.

The publisher refuses to start without `BLOG_ADMIN_PASSWORD`, run outside the `main` branch, or publish while the Git staging area already contains changes. Stop it with `Ctrl+C` when you are done.
