<?php
/**
 * Plugin Name: Lab Notes
 * Description: A tiny starting point for your next WordPress idea.
 * Version: 0.1.0
 */

defined('ABSPATH') || exit;

add_action('wp_dashboard_setup', function () {
    wp_add_dashboard_widget('wordpress_lab_notes', 'Your idea starts here', function () {
        echo '<p>Edit <code>plugins/lab-notes/lab-notes.php</code> and refresh this page. Your changes are live.</p>';
    });
});
