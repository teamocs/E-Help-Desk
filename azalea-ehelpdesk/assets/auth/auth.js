/*
 * Azalea e-Helpdesk sign-in pages: show/hide password, and the three forms (login, forgot, reset),
 * which post JSON to the plugin's REST routes. No libraries, no inline script (the page CSP forbids it).
 */
(function () {
	'use strict';

	var OFFLINE = 'Could not reach the server. Check the connection and try again.';
	var GENERIC = 'Something went wrong. Try again.';

	function each(list, fn) {
		Array.prototype.forEach.call(list, fn);
	}

	/* ---------- show / hide password ---------- */

	each(document.querySelectorAll('[data-azl-reveal]'), function (btn) {
		var input = document.getElementById(btn.getAttribute('aria-controls'));
		var label = btn.querySelector('[data-azl-reveal-label]');
		if (!input || !label) return;
		btn.addEventListener('click', function () {
			var show = input.type === 'password';
			input.type = show ? 'text' : 'password';
			btn.setAttribute('aria-pressed', show ? 'true' : 'false');
			label.textContent = show ? 'Hide' : 'Show';
		});
	});

	function hidePasswords(form) {
		each(form.querySelectorAll('[data-azl-reveal]'), function (btn) {
			var input = document.getElementById(btn.getAttribute('aria-controls'));
			if (input && input.type === 'text') btn.click();
		});
	}

	/* ---------- messages ---------- */

	function say(form, kind, text) {
		var box = form.querySelector('[data-azl-msg]');
		if (!box) return;
		box.className = 'azl-alert' + (text ? ' azl-alert--' + kind : '');
		box.textContent = text || '';
	}

	function invalid(form, fields) {
		each(form.querySelectorAll('input[aria-invalid]'), function (el) {
			el.removeAttribute('aria-invalid');
		});
		(fields || []).forEach(function (el) {
			if (el) el.setAttribute('aria-invalid', 'true');
		});
	}

	function busy(form, on) {
		var btn = form.querySelector('button[type="submit"]');
		var label = btn && btn.querySelector('.azl-btn__label');
		form.setAttribute('aria-busy', on ? 'true' : 'false');
		if (!btn || !label) return;
		if (!btn.hasAttribute('data-idle-label')) btn.setAttribute('data-idle-label', label.textContent);
		btn.disabled = on;
		label.textContent = on ? btn.getAttribute('data-busy-label') : btn.getAttribute('data-idle-label');
	}

	/* ---------- checks before sending ---------- */

	function problem(kind, form) {
		var f = form.elements;
		if (kind === 'login') {
			if (!f.login.value.trim()) return { field: f.login, text: 'Enter your email or username.' };
			if (!f.password.value) return { field: f.password, text: 'Enter your password.' };
		}
		if (kind === 'forgot') {
			if (!f.email.value.trim() || !f.email.validity.valid) return { field: f.email, text: 'Enter the email address of your account.' };
		}
		if (kind === 'reset') {
			var min = Number(form.getAttribute('data-min')) || 10;
			var login = (form.getAttribute('data-login') || '').toLowerCase();
			if (f.password.value.length < min) return { field: f.password, text: 'Use at least ' + min + ' characters.' };
			if (f.password.value.trim().toLowerCase() === login) return { field: f.password, text: 'Do not use your email address as the password.' };
			if (f.again.value !== f.password.value) return { field: f.again, text: 'The two passwords are not the same.' };
		}
		return null;
	}

	function body(kind, form) {
		var f = form.elements;
		if (kind === 'login') {
			return { login: f.login.value.trim(), password: f.password.value, remember: f.remember.checked, csrf: f.csrf.value, redirectTo: f.redirectTo.value };
		}
		if (kind === 'forgot') return { email: f.email.value.trim(), csrf: f.csrf.value };
		return { login: f.login.value, key: f.key.value, password: f.password.value, csrf: f.csrf.value };
	}

	/** Only ever leave for a page on this site. */
	function go(url, fallback) {
		try {
			var u = new URL(url, window.location.href);
			window.location.assign(u.origin === window.location.origin ? u.href : fallback);
		} catch (e) {
			window.location.assign(fallback);
		}
	}

	/* ---------- the forms ---------- */

	function done(kind, form, status, data) {
		var ok = status >= 200 && status < 300 && data && data.ok === true;
		var f = form.elements;
		if (ok && kind === 'login') {
			go(data.redirect, form.getAttribute('data-desk') || '/');
			return true; // stay busy while the desk loads
		}
		if (ok && kind === 'forgot') {
			say(form, 'ok', data.message);
			return false;
		}
		if (ok && kind === 'reset') {
			var step = document.querySelector('[data-azl-step]');
			var fin = document.querySelector('[data-azl-done]');
			if (step && fin) {
				step.hidden = true;
				fin.hidden = false;
				var h = fin.querySelector('h1');
				if (h) h.focus();
			}
			return false;
		}
		if (data && data.code === 'azl_expired' && kind === 'reset') {
			window.location.reload(); // the page itself shows the expired-link view
			return true;
		}
		var text = data && typeof data.error === 'string' ? data.error : GENERIC;
		say(form, 'error', text);
		if (kind === 'login' && data && data.code === 'azl_failed') {
			f.password.value = '';
			invalid(form, [f.login, f.password]);
			f.password.focus();
		} else if (kind === 'reset' && data && data.code === 'azl_weak') {
			invalid(form, [f.password]);
			f.password.focus();
		}
		return false;
	}

	each(document.querySelectorAll('form[data-azl-form]'), function (form) {
		var kind = form.getAttribute('data-azl-form');
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			if (form.getAttribute('aria-busy') === 'true') return;
			var p = problem(kind, form);
			if (p) {
				invalid(form, [p.field]);
				say(form, 'error', p.text);
				p.field.focus();
				return;
			}
			invalid(form, []);
			say(form, '', '');
			hidePasswords(form);
			busy(form, true);
			fetch(form.getAttribute('data-endpoint'), {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify(body(kind, form))
			})
				.then(function (res) {
					return res.json().catch(function () {
						return null;
					}).then(function (data) {
						return done(kind, form, res.status, data);
					});
				})
				.catch(function () {
					say(form, 'error', OFFLINE);
					return false;
				})
				.then(function (stayBusy) {
					if (!stayBusy) busy(form, false);
				});
		});
	});
})();
