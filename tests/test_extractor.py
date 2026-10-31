"""Small hand-authored fixtures; no game install needed for extractor unit tests."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('extract_tf3', pathlib.Path(__file__).resolve().parents[1]/'scripts/extract_tf3.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ExtractorTests(unittest.TestCase):
    def test_literal_parser_does_not_execute_lua(self):
        self.assertEqual(extractor.table('return {name = _("Test"), scale = 1/6, values={-2, 3e2}, ["flag"] = true}', 'return'), {'name':'Test','scale':1/6,'values':[-2,300],'flag':True})
        with self.assertRaises(ValueError):
            extractor.table('return {value = execute("anything")}', 'return')

    def test_compartments_sum_but_alternative_load_configs_do_not(self):
        def config(capacity):
            return {'cargoEntry':{'capacity':capacity,'cargoTypeSet':{'cargoClassesIncluded':['BULK'],'cargoTypesExcluded':['SAND']}}}
        tv={'compartments':[{'loadConfigs':[config(80),config(100)]},{'loadConfigs':[config(40)]}]}
        cargos=[{'id':'COAL','classes':['BULK']},{'id':'SAND','classes':['BULK']},{'id':'PASSENGERS','classes':['PASSENGERS']}]
        self.assertEqual(extractor.capacity_by_cargo(tv,cargos),{'COAL':35})

    def test_explicit_cargo_inclusion_and_class_exclusion(self):
        tv={'compartments':[{'loadConfigs':[{'cargoEntry':{'capacity':48,'cargoTypeSet':{'cargoTypesIncluded':['COAL','SAND'],'cargoClassesExcluded':['FORBIDDEN']}}}]}]}
        cargos=[{'id':'COAL','classes':['BULK']},{'id':'SAND','classes':['FORBIDDEN']}]
        self.assertEqual(extractor.capacity_by_cargo(tv,cargos),{'COAL':12})


if __name__=='__main__':
    unittest.main()
