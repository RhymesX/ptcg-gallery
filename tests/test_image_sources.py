import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from ptcg_gallery import image_service
from ptcg_gallery import mikmoe_source


class ImageSourceTests(unittest.TestCase):
    def test_user_image_matching_uses_card_code_for_numbered_cards(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            user_dir = Path(temp_dir) / "card_images_user"
            user_dir.mkdir()
            (user_dir / "SET-205.png").write_bytes(b"205")
            (user_dir / "SET-206.png").write_bytes(b"206")
            (user_dir / "SET-Mew ex.png").write_bytes(b"name-only")

            service = image_service.ImageService(Path(temp_dir))
            self.assertEqual(
                service._user_file("Mew ex", "SET", "205/165"),
                "/api/images/user/SET-205.png",
            )
            self.assertEqual(
                service._user_file("Mew ex", "SET", "206/165"),
                "/api/images/user/SET-206.png",
            )
            self.assertIsNone(service._user_file("Mew ex", "SET", "207/165"))

    def test_mikmoe_same_name_index_requires_matching_card_number(self):
        self.assertEqual(mikmoe_source._pick_best(["205", "206"], "205/165"), "205")
        self.assertEqual(mikmoe_source._pick_best(["205", "206"], "206/165"), "206")
        self.assertIsNone(mikmoe_source._pick_best(["205", "206"], "207/165"))

    def test_mikmoe_number_parser_supports_set_prefixed_codes(self):
        self.assertEqual(mikmoe_source._extract_number("054/072"), "54")
        self.assertEqual(mikmoe_source._extract_number("SV4a-205"), "205")
        self.assertEqual(mikmoe_source._extract_number("081"), "81")

    def test_ptcg_api_fallback_queries_card_number(self):
        queries = []

        def fake_find(query):
            queries.append(query)
            return "https://example.test/mew-205.png"

        with patch.object(image_service, "translate_card_name", return_value="Mew ex"), patch.object(
            image_service, "_api_find", side_effect=fake_find
        ):
            url = image_service.source_ptcg_api("梦幻ex", "SV4a", "205/165")

        self.assertEqual(url, "https://example.test/mew-205.png")
        self.assertEqual(queries, ['name:"Mew ex" number:205'])


if __name__ == "__main__":
    unittest.main()
