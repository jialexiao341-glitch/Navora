import unittest

from channel.web import web_channel
from channel.web.api.pages import PetHandler
from channel.web.core import template


class TestWebPetRoute(unittest.TestCase):
    def test_pet_route_registered(self):
        urls = list(web_channel.URLS)
        pairs = dict(zip(urls[0::2], urls[1::2]))
        self.assertEqual(pairs.get("/pet"), "PetHandler")
        self.assertTrue(hasattr(PetHandler, "GET"))

    def test_pet_template_renders_cleanly(self):
        html = template.render("pet.html")
        self.assertIn("pet-window-mode", html)
        self.assertIn("indesktop-pet", html)
        self.assertIn("pet-desktop-window", html)
        self.assertIn("indesktop-pet.js?v=", html)
        self.assertIn("indesktop-pet.css?v=", html)


if __name__ == "__main__":
    unittest.main()
